import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT, installFileReaderPolyfill, loginAs, makePhotoSet } from './excelTestUtils'
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'

// M-3: Excel出力時に写真が取得できなかった場合、失敗枚数と対象のNo.を利用者へ知らせる。
// 画像の取得結果（IndexedDB・クラウド・変換）をモックで制御し、実際の Excel 生成を通して確認する。
// 外部サービスには接続しない。

const mocks = vi.hoisted(() => ({
  compressed: new Map<string, 'ok' | 'none' | 'throw' | 'badblob'>(),
  cloud: new Map<string, 'ok' | 'none' | 'throw' | 'badblob'>(),
  defaultCompressed: 'ok' as 'ok' | 'none' | 'throw' | 'badblob',
  defaultCloud: 'none' as 'ok' | 'none' | 'throw' | 'badblob',
}))

vi.mock('@/lib/photoStorage', async () => ({
  photoStorage: {
    getCompressedBlob: async (id: string) => {
      const m = mocks.compressed.get(id) ?? mocks.defaultCompressed
      if (m === 'throw') throw new Error('indexeddb failed')
      if (m === 'none') return null
      if (m === 'badblob') return { arrayBuffer: () => Promise.reject(new Error('convert failed')), type: 'image/jpeg' }
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])], { type: 'image/jpeg' })
    },
    getObjectURL: async () => null,
  },
}))
vi.mock('@/lib/cloudSync', () => ({
  downloadCloudCompressed: async (path: string) => {
    const id = path.replace(/^.*\//, '').replace(/\.jpg$/, '')
    const m = mocks.cloud.get(id) ?? mocks.defaultCloud
    if (m === 'throw') throw new Error('cloud failed')
    if (m === 'none') return null
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])], { type: 'image/jpeg' })
  },
}))

import { generateExcel } from '@/lib/generateExcel'
import { generateOneColumnExcel, listOneColumnExcelPages } from '@/lib/generateOneColumnExcel'
import { generateBeforeAfterExcel, listBeforeAfterExcelPages } from '@/lib/generateBeforeAfterExcel'
import { listStandardExcelPages } from '@/lib/generateExcel'
import { buildExcelPhotoNotice } from '@/lib/excelImageReport'
import type { Photo } from '@/types/photo'

let downloads: string[]
let photos: Photo[]
const byPhase = (phase: string) => photos.filter((p) => p.phase === phase)
const failBoth = (...ps: Photo[]) =>
  ps.forEach((p) => {
    mocks.compressed.set(p.id, 'none')
    mocks.cloud.set(p.id, 'none')
  })

beforeAll(() => {
  installFileReaderPolyfill()
})
beforeEach(async () => {
  mocks.compressed.clear()
  mocks.cloud.clear()
  mocks.defaultCompressed = 'ok'
  mocks.defaultCloud = 'none'
  downloads = []
  photos = makePhotoSet() // 施工前7・施工中2・施工後4（標準: No.1〜13 のシート通し番号）
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', click: () => downloads.push(a.download) }
      return a
    },
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })
  await loginAs('user-1')
})

describe('標準Excel', () => {
  it('全写真取得成功：従来どおり出力し、通知は不要', async () => {
    const r = await generateExcel(PROJECT, photos)
    expect(r).toMatchObject({ total: 13, missing: [], downloaded: true })
    expect(downloads).toHaveLength(1)
    expect(buildExcelPhotoNotice(r)).toBeNull()
  })

  it('一部取得失敗：取得できた写真は出力し、Excel上のNo.と失敗枚数を返す（並び順どおり）', async () => {
    failBoth(byPhase('after')[1], byPhase('before')[2]) // 施工前3枚目＝No.3、施工後2枚目＝No.11
    const r = await generateExcel(PROJECT, photos)
    expect(r.downloaded).toBe(true)
    expect(downloads).toHaveLength(1)
    expect(r.missing.map((m) => m.label)).toEqual(['No.3', 'No.11'])
    const notice = buildExcelPhotoNotice(r)!
    expect(notice).toMatchObject({ kind: 'warning', countLine: '取得失敗：2枚', labels: ['No.3', 'No.11'] })
    expect(notice.hint).toContain('提出前に内容をご確認ください')
  })

  it('選択ページ出力でも、Excel上の番号（ページの開始番号から）で報告する', async () => {
    const pages = listStandardExcelPages(photos)
    const page = pages[1] // 施工前の2ページ目（No.7〜）
    failBoth(page.items[0])
    const r = await generateExcel(PROJECT, photos, page)
    expect(r.missing.map((m) => m.label)).toEqual([`No.${page.startNo}`])
  })

  it('全写真取得失敗：Excelをダウンロードせず、エラー通知にする', async () => {
    failBoth(...photos)
    const r = await generateExcel(PROJECT, photos)
    expect(r).toMatchObject({ total: 13, downloaded: false })
    expect(r.missing).toHaveLength(13)
    expect(downloads).toEqual([])
    const notice = buildExcelPhotoNotice(r)!
    expect(notice).toMatchObject({ kind: 'error', countLine: '取得失敗：13枚', labels: [] })
    expect(notice.title).toContain('Excel出力を中止しました')
    // 原因は断定しない
    expect(JSON.stringify(notice)).not.toMatch(/ネットワーク|認証|権限/)
  })
})

describe('画像取得の失敗の検知と、別の取得方法での成功', () => {
  it('クラウド取得の失敗（例外）を検知する', async () => {
    mocks.compressed.set(byPhase('before')[0].id, 'none')
    mocks.cloud.set(byPhase('before')[0].id, 'throw')
    photos[photos.indexOf(byPhase('before')[0])] = { ...byPhase('before')[0], storage_path: `user-1/${byPhase('before')[0].id}.jpg` }
    const r = await generateExcel(PROJECT, photos)
    expect(r.missing.map((m) => m.label)).toEqual(['No.1'])
  })

  it('クラウドに画像が無い（null）ことを検知する', async () => {
    const p = byPhase('during')[0]
    mocks.compressed.set(p.id, 'none')
    photos[photos.indexOf(p)] = { ...p, storage_path: `user-1/${p.id}.jpg` }
    mocks.cloud.set(p.id, 'none')
    expect((await generateExcel(PROJECT, photos)).missing.map((m) => m.label)).toEqual(['No.8'])
  })

  it('IndexedDB の取得失敗（例外）を検知する', async () => {
    const p = byPhase('after')[0]
    mocks.compressed.set(p.id, 'throw')
    expect((await generateExcel(PROJECT, photos)).missing.map((m) => m.label)).toEqual(['No.10'])
  })

  it('画像データの変換に失敗した場合も、検知する', async () => {
    const p = byPhase('before')[1]
    mocks.compressed.set(p.id, 'badblob')
    expect((await generateExcel(PROJECT, photos)).missing.map((m) => m.label)).toEqual(['No.2'])
  })

  it('途中の取得（IndexedDB）が失敗しても、クラウドで取得できれば成功として扱う', async () => {
    const p = byPhase('before')[0]
    photos[photos.indexOf(p)] = { ...p, storage_path: `user-1/${p.id}.jpg` }
    mocks.compressed.set(p.id, 'throw')
    mocks.cloud.set(p.id, 'ok')
    const r = await generateExcel(PROJECT, photos)
    expect(r.missing).toEqual([])
  })

  it('端末内の圧縮画像が無くても、クラウドで取得できれば成功として扱う', async () => {
    const p = byPhase('after')[0]
    photos[photos.indexOf(p)] = { ...p, storage_path: `user-1/${p.id}.jpg` }
    mocks.compressed.set(p.id, 'none')
    mocks.cloud.set(p.id, 'ok')
    expect((await generateExcel(PROJECT, photos)).missing).toEqual([])
  })
})

describe('大判Excel', () => {
  it('一部失敗：No.と枚数を返す／全件失敗：ダウンロードしない', async () => {
    failBoth(byPhase('before')[4], byPhase('after')[3]) // No.5、No.13
    const r = await generateOneColumnExcel(PROJECT, photos)
    expect(r.downloaded).toBe(true)
    expect(r.missing.map((m) => m.label)).toEqual(['No.5', 'No.13'])
    downloads.length = 0
    failBoth(...photos)
    const all = await generateOneColumnExcel(PROJECT, photos)
    expect(all.downloaded).toBe(false)
    expect(downloads).toEqual([])
  })

  it('選択ページ出力でも、ページの開始番号から報告する', async () => {
    const page = listOneColumnExcelPages(photos)[1]
    failBoth(page.items[0])
    const r = await generateOneColumnExcel(PROJECT, photos, page)
    expect(r.missing.map((m) => m.label)).toEqual([`No.${page.startNo}`])
  })
})

describe('施工前後Excel', () => {
  it('施工前・施工後のどちらが欠けたか分かる（同じ組番号でも区別する）', async () => {
    failBoth(byPhase('before')[1], byPhase('after')[1], byPhase('after')[2])
    const r = await generateBeforeAfterExcel(PROJECT, photos)
    expect(r.downloaded).toBe(true)
    expect(r.missing.map((m) => m.label)).toEqual(['施工前 No.2', '施工後 No.2', '施工後 No.3'])
    expect(buildExcelPhotoNotice(r)!.labels).toEqual(['施工前 No.2', '施工後 No.2', '施工後 No.3'])
  })

  it('片方だけ失敗した組は、その片方だけを報告する', async () => {
    failBoth(byPhase('after')[0])
    const r = await generateBeforeAfterExcel(PROJECT, photos)
    expect(r.missing.map((m) => m.label)).toEqual(['施工後 No.1'])
  })

  it('全件失敗：ダウンロードしない／選択ページ出力は組番号（開始番号から）で報告する', async () => {
    const page = listBeforeAfterExcelPages(photos)[0]
    failBoth(...photos)
    const all = await generateBeforeAfterExcel(PROJECT, photos)
    expect(all).toMatchObject({ downloaded: false })
    expect(downloads).toEqual([])
    mocks.compressed.clear()
    mocks.cloud.clear()
    failBoth(page.items[0].before!)
    const r = await generateBeforeAfterExcel(PROJECT, photos, page)
    expect(r.missing.map((m) => m.label)).toEqual([`施工前 No.${page.startNo}`])
  })
})

describe('通知の内容', () => {
  it('写真IDを通知に含めない（表示するのはExcel上のNo.のみ）', async () => {
    failBoth(byPhase('before')[0], byPhase('after')[0])
    const r = await generateExcel(PROJECT, photos)
    const text = JSON.stringify(buildExcelPhotoNotice(r))
    for (const p of photos) expect(text).not.toContain(p.id)
    expect(r.missing[0].photoId).toBe(byPhase('before')[0].id) // 内部の識別用には保持
  })

  it('大量に失敗しても、全ての対象を確認できる（一行に並べず、スクロールできる領域に表示する）', async () => {
    const result = {
      total: 200,
      downloaded: true,
      missing: Array.from({ length: 150 }, (_, i) => ({ photoId: `id-${i}`, label: `No.${i + 1}` })),
    }
    const notice = buildExcelPhotoNotice(result)!
    expect(notice.countLine).toBe('取得失敗：150枚')
    expect(notice.labels).toHaveLength(150)
    const src = readFileSync(nodePath.resolve(__dirname, '../../src/components/project/ExcelExportButton.tsx'), 'utf8')
    expect(src).toMatch(/max-h-32 overflow-y-auto/)
    // 警告は自動で閉じない（ms=0）。利用者が「閉じる」で閉じる
    expect(src).toMatch(/offerStandard: false, notice \}, 0\)/)
    expect(src).toContain('閉じる')
  })
})

describe('Excelファイルの生成・保存の失敗は、写真取得失敗と区別する', () => {
  it('ダウンロード（保存）処理が失敗した場合は、結果ではなくエラーとして伝わる', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        href: '',
        download: '',
        click: () => {
          throw new Error('save failed')
        },
      }),
    })
    await expect(generateExcel(PROJECT, photos)).rejects.toThrow('save failed')
  })

  it('全写真が取得できた場合に、取得失敗の通知は作られない', async () => {
    const r = await generateExcel(PROJECT, photos)
    expect(buildExcelPhotoNotice(r)).toBeNull()
  })
})
