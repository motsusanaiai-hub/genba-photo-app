import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

// 写真ZIP・Excel 出力の画像取得（getPhotoJpegBlob）と ZIP の構成。
// クラウド画像は認証付きで取得する（downloadCloudCompressed）。IndexedDB と Supabase はモック。
// Excel のレイアウト・写真番号・ページ番号は excelLayout.test.ts / genbafotoJob.test.ts が確認している（変更なし）。

const mocks = vi.hoisted(() => ({
  compressed: new Map<string, Blob>(),
  originals: new Map<string, Blob>(),
  cloud: vi.fn<(path: string) => Promise<Blob | null>>(),
  trigger: vi.fn<(blob: Blob, filename: string) => void>(),
}))

vi.mock('@/lib/photoStorage', () => ({
  photoStorage: {
    getCompressedBlob: async (id: string) => mocks.compressed.get(id) ?? null,
    getBlob: async (id: string) => mocks.originals.get(id) ?? null,
    getObjectURL: async () => null, // 原本からの 600px 生成は DOM が必要なため、ここでは使わない
  },
}))
vi.mock('@/lib/cloudSync', () => ({ downloadCloudCompressed: (path: string) => mocks.cloud(path) }))
vi.mock('@/lib/generateExcel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/generateExcel')>()),
  triggerBlobDownload: (blob: Blob, filename: string) => mocks.trigger(blob, filename),
}))

import { getPhotoJpegBlob } from '@/lib/generateExcel'
import { generateZip } from '@/lib/generateZip'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { loginAs } from './excelTestUtils'

await loginAs('user-a')

const photo = (id: string, overrides: Partial<Photo> = {}): Photo =>
  ({
    id,
    project_id: 'p1',
    user_id: 'user-a',
    original_filename: `${id}.jpg`,
    phase: 'before',
    sort_order: 1,
    comment: '',
    thumbnail_data_url: '',
    storage_path: `user-a/${id}.jpg`,
    ...overrides,
  }) as Photo
const project = { id: 'p1', name: 'テスト/工事', user_id: 'user-a' } as Project
// JSZip は Node 上では Blob の中身を読めない（ブラウザでは読める）ため、テストでは Buffer を Blob として渡す。
// 出力処理は受け取った画像を ZIP に入れるだけで、中身の種類には依存しない。
const blobOf = (text: string) => Buffer.from(text) as unknown as Blob

beforeEach(() => {
  mocks.compressed.clear()
  mocks.originals.clear()
  mocks.cloud.mockReset()
  mocks.cloud.mockResolvedValue(null)
  mocks.trigger.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('getPhotoJpegBlob（Excel・ZIP の画像取得）', () => {
  it('端末内の圧縮画像（IndexedDB）を最優先する。クラウドには取りに行かない', async () => {
    const local = blobOf('local')
    mocks.compressed.set('a', local)
    expect(await getPhotoJpegBlob(photo('a'))).toBe(local)
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('端末内に無ければ、クラウドの画像を認証付きで取得する（storage_path で指定）', async () => {
    const cloud = blobOf('cloud')
    mocks.cloud.mockResolvedValue(cloud)
    expect(await getPhotoJpegBlob(photo('a'))).toBe(cloud)
    expect(mocks.cloud).toHaveBeenCalledTimes(1)
    expect(mocks.cloud).toHaveBeenCalledWith('user-a/a.jpg')
  })

  it('storage_path が null の写真は、クラウドへ取りに行かない', async () => {
    expect(await getPhotoJpegBlob(photo('a', { storage_path: null }))).toBeNull()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('クラウドから取得できず、端末内にも元画像・サムネイルが無ければ null（呼び出し側の警告とスキップに任せる）', async () => {
    mocks.cloud.mockResolvedValue(null)
    expect(await getPhotoJpegBlob(photo('a'))).toBeNull()
  })

  it('取得処理が例外を投げても、例外にせず null', async () => {
    mocks.cloud.mockRejectedValue(new TypeError('fetch failed'))
    expect(await getPhotoJpegBlob(photo('a'))).toBeNull()
  })
})

async function zipEntries(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort()
}

describe('写真ZIP', () => {
  it('圧縮画像：端末内・クラウドの画像を含め、フォルダ構成（フェーズ別・連番）は従来どおり', async () => {
    mocks.compressed.set('b1', blobOf('b1'))
    mocks.cloud.mockImplementation(async (path) => (path.includes('b2') || path.includes('u1') ? blobOf(path) : null))
    const photos = [
      photo('b1'),
      photo('b2'),
      photo('a1', { phase: 'after' }), // クラウドにも無い → 含められない
      photo('u1', { phase: null }),
    ]

    const result = await generateZip(project, photos, 'compressed')

    expect(result).toEqual({ created: true, missingOriginals: 0, missingCompressed: 1, totalPhotos: 4 })
    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    const [blob, filename] = mocks.trigger.mock.calls[0]
    expect(filename).toBe('テスト_工事_圧縮写真.zip')
    expect(await zipEntries(blob)).toEqual(['compressed/施工前/001.jpg', 'compressed/施工前/002.jpg', 'compressed/未分類/001.jpg'])
  })

  it('元画像：端末内（IndexedDB）にある分だけ含め、無い分は警告してスキップする', async () => {
    mocks.originals.set('b1', blobOf('o1'))
    const result = await generateZip(project, [photo('b1'), photo('b2')], 'original')
    expect(result).toEqual({ created: true, missingOriginals: 1, missingCompressed: 0, totalPhotos: 2 })
    expect(await zipEntries(mocks.trigger.mock.calls[0][0])).toEqual(['original/施工前/001.jpg'])
    expect(console.warn).toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled() // 元画像はクラウドから取得しない（IndexedDB のみ）
  })

  it('元画像が1枚も端末内に無い場合は、ZIPを作らない（従来どおり）', async () => {
    const result = await generateZip(project, [photo('b1'), photo('b2')], 'original')
    expect(result).toEqual({ created: false, missingOriginals: 2, missingCompressed: 0, totalPhotos: 2 })
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('圧縮＋元画像：compressed/ と original/ の両方を含める。元画像だけが無くても出力できる', async () => {
    mocks.compressed.set('b1', blobOf('c1'))
    const result = await generateZip(project, [photo('b1')], 'both')
    expect(result).toMatchObject({ created: true, missingOriginals: 1, missingCompressed: 0 })
    expect(await zipEntries(mocks.trigger.mock.calls[0][0])).toEqual(['compressed/施工前/001.jpg'])
  })

  it('出力中に通信が失敗した写真があっても、出力は完了し、含められなかった枚数を返す', async () => {
    mocks.cloud.mockImplementation(async (path) => {
      const n = Number(/photo-(\d+)/.exec(path)?.[1])
      if (n % 3 === 0) throw new TypeError('fetch failed')
      if (n % 3 === 1) return null
      return blobOf(path)
    })
    const photos = Array.from({ length: 9 }, (_, i) => photo(`photo-${i}`))
    const result = await generateZip(project, photos, 'compressed')
    expect(result.created).toBe(true)
    expect(result.missingCompressed).toBe(6)
    expect((await zipEntries(mocks.trigger.mock.calls[0][0])).length).toBe(3)
  })

  it('大量の写真（150枚）でも、写真は1枚ずつ順に取得する（同時に大量のダウンロードやメモリを使わない）', async () => {
    let active = 0
    let maxActive = 0
    mocks.cloud.mockImplementation(async (path) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 0))
      active--
      return blobOf(path)
    })
    const photos = Array.from({ length: 150 }, (_, i) => photo(`photo-${i}`))
    const result = await generateZip(project, photos, 'compressed')
    expect(result).toMatchObject({ created: true, missingCompressed: 0, totalPhotos: 150 })
    expect(maxActive).toBe(1)
    expect(mocks.cloud).toHaveBeenCalledTimes(150)
  })
})
