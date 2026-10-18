import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT, installFileReaderPolyfill, loginAs, makePhoto, makePhotoSet } from './excelTestUtils'

// H-1: 他人の工事案件・写真は、ZIP・Excel（標準・大判・施工前後）・Excel直接作成（genbafoto）で出力できないこと。
// 画面の非表示だけに頼らず、出力処理そのものを確認する。外部サービスには接続しない（全てモック）。

const mocks = vi.hoisted(() => ({
  reads: [] as string[],
  cloudReads: [] as string[],
  trigger: vi.fn<(blob: Blob, filename: string) => void>(),
}))

vi.mock('@/lib/photoStorage', () => ({
  photoStorage: {
    getCompressedBlob: async (id: string) => {
      mocks.reads.push(`compressed:${id}`)
      return Buffer.from(`c-${id}`) as unknown as Blob
    },
    getBlob: async (id: string) => {
      mocks.reads.push(`original:${id}`)
      return Buffer.from(`o-${id}`) as unknown as Blob
    },
    getObjectURL: async (id: string) => {
      mocks.reads.push(`url:${id}`)
      return null
    },
  },
}))
vi.mock('@/lib/cloudSync', () => ({
  downloadCloudCompressed: async (path: string) => {
    mocks.cloudReads.push(path)
    return null
  },
}))
vi.mock('@/lib/generateExcel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/generateExcel')>()),
  triggerBlobDownload: (blob: Blob, filename: string) => mocks.trigger(blob, filename),
}))

import { generateExcel } from '@/lib/generateExcel'
import { generateOneColumnExcel } from '@/lib/generateOneColumnExcel'
import { generateBeforeAfterExcel } from '@/lib/generateBeforeAfterExcel'
import { generateGenbafotoJob } from '@/lib/generateGenbafotoJob'
import { generateZip } from '@/lib/generateZip'
import { ExportNotAllowedError } from '@/lib/exportGuard'
import type { Photo } from '@/types/photo'

const OWNER = 'user-1' // excelTestUtils の PROJECT / 写真の所有者
const OTHER = 'user-2'

const photos = (): Photo[] => [
  makePhoto('before', { sort_order: 1000 }),
  makePhoto('after', { sort_order: 2000 }),
]

let downloads: string[]
beforeAll(() => {
  installFileReaderPolyfill()
})
beforeEach(async () => {
  mocks.reads.length = 0
  mocks.cloudReads.length = 0
  mocks.trigger.mockReset()
  downloads = []
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', click: () => downloads.push(a.download) }
      return a
    },
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })
  await loginAs(OTHER)
})

describe('他人の工事案件は出力できない（ユーザーBがAの工事案件を出力しようとする）', () => {
  it('ZIP：何も生成せず、端末内の原本・圧縮画像にもクラウドにも触れない', async () => {
    for (const mode of ['compressed', 'original', 'both'] as const) {
      const result = await generateZip(PROJECT, photos(), mode)
      expect(result).toEqual({ created: false, missingOriginals: 0, missingCompressed: 0, totalPhotos: 0 })
    }
    expect(mocks.trigger).not.toHaveBeenCalled()
    expect(mocks.reads).toEqual([])
    expect(mocks.cloudReads).toEqual([])
  })

  it('標準・大判・施工前後のExcel：どれも出力せず、画像にも触れない', async () => {
    const set = makePhotoSet()
    await expect(generateExcel(PROJECT, set)).rejects.toBeInstanceOf(ExportNotAllowedError)
    await expect(generateOneColumnExcel(PROJECT, set)).rejects.toBeInstanceOf(ExportNotAllowedError)
    await expect(generateBeforeAfterExcel(PROJECT, set)).rejects.toBeInstanceOf(ExportNotAllowedError)
    expect(downloads).toEqual([])
    expect(mocks.reads).toEqual([])
    expect(mocks.cloudReads).toEqual([])
  })

  it('Excel直接作成（genbafoto）：APIを呼ばず、ファイルも作らず、写真が無い場合と同じ結果（存在を知らせない）', async () => {
    const fetchImpl = vi.fn()
    const download = vi.fn()
    const result = await generateGenbafotoJob(PROJECT, photos().map((p) => ({ ...p, storage_path: 'x/y.jpg' })), 'standard', {
      getAccessToken: async () => 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      download,
    })
    expect(result).toMatchObject({ ok: false, reason: 'no_photos' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('未ログイン・認証の確認前も、同じく出力できない', async () => {
    const { useAuthStore } = await import('@/store/authStore')
    useAuthStore.setState({ user: null, initialized: true })
    expect((await generateZip(PROJECT, photos(), 'both')).created).toBe(false)
    await expect(generateExcel(PROJECT, photos())).rejects.toBeInstanceOf(ExportNotAllowedError)
    await loginAs(OWNER)
    useAuthStore.setState({ initialized: false })
    expect((await generateZip(PROJECT, photos(), 'both')).created).toBe(false)
    await expect(generateOneColumnExcel(PROJECT, photos())).rejects.toBeInstanceOf(ExportNotAllowedError)
  })
})

describe('本人の工事案件は出力できる（ユーザーAが再ログインした場合）', () => {
  beforeEach(async () => {
    await loginAs(OWNER)
  })

  it('ZIP：本人の写真が出力される', async () => {
    const result = await generateZip(PROJECT, photos(), 'compressed')
    expect(result).toMatchObject({ created: true, totalPhotos: 2 })
    expect(mocks.trigger).toHaveBeenCalledTimes(1)
  })

  it('標準Excel：出力される', async () => {
    await generateExcel(PROJECT, makePhotoSet())
    expect(downloads).toHaveLength(1)
  })

  it('Excel直接作成：本人の写真でAPIを呼び、ファイルが作られる', async () => {
    const download = vi.fn()
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const { photoIds } = JSON.parse(String(init?.body)) as { photoIds: string[] }
      return new Response(
        JSON.stringify({ expiresAt: '2026-10-12T00:30:00.000Z', photos: photoIds.map((id) => ({ id, imageUrl: `https://example.test/${id}.jpg` })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const result = await generateGenbafotoJob(PROJECT, photos().map((p) => ({ ...p, storage_path: `${OWNER}/${p.id}.jpg` })), 'standard', {
      getAccessToken: async () => 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-10-12T00:00:00.000Z'),
      download,
    })
    expect(result.ok).toBe(true)
    expect(download).toHaveBeenCalledTimes(1)
  })
})

describe('本人の工事案件に他人の写真が混ざっていても、他人の写真は出力しない', () => {
  it('ZIP：他人の user_id の写真は含めず、端末内の画像も読まない', async () => {
    await loginAs(OWNER)
    const mine = makePhoto('before', { sort_order: 1000 })
    const foreign = makePhoto('before', { sort_order: 2000, user_id: OTHER })
    const result = await generateZip(PROJECT, [mine, foreign], 'both')
    expect(result.totalPhotos).toBe(1)
    expect(mocks.reads.some((r) => r.endsWith(foreign.id))).toBe(false)
    expect(mocks.reads.some((r) => r.endsWith(mine.id))).toBe(true)
  })

  it('他の工事案件の写真も含めない', async () => {
    await loginAs(OWNER)
    const mine = makePhoto('before')
    const elsewhere = makePhoto('before', { project_id: 'other-project' })
    const result = await generateZip(PROJECT, [mine, elsewhere], 'compressed')
    expect(result.totalPhotos).toBe(1)
  })
})
