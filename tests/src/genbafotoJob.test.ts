import { describe, expect, it, vi } from 'vitest'
import { PROJECT, makePhoto } from './excelTestUtils'

// Excel直接作成モード（.genbafoto）の番号とページ情報（STEP 6-C）。
//   - 全ページ出力：no は従来どおり1からの通し番号、page は付けない
//   - 選択ページ出力：no はページの startNo から、page { groupIndex, startNo, endNo } を付ける
//   - 施工前後は同じ組の施工前・施工後が同じ no（ペアリングは従来どおり）
//   - schemaVersion は 1 のまま
// ページは Web標準モードと同じ listPages 関数で作り、ExcelExportButton と同じ経路
// （pageItemsToPhotos → toGenbafotoPage → generateGenbafotoJob）で .genbafoto を生成する。
// 認証・API・ダウンロードだけを差し替え、.genbafoto の中身（ダウンロードされる JSON）を確認する。

vi.mock('@/lib/photoStorage', () => ({
  photoStorage: { getCompressedBlob: async () => null, getObjectURL: async () => null },
}))
vi.mock('@/lib/cloudSync', () => ({ downloadCloudCompressed: async () => null }))

import { buildExcelWorkbook, listStandardExcelPages, type ExcelPageInfo } from '@/lib/generateExcel'
import { listOneColumnExcelPages } from '@/lib/generateOneColumnExcel'
import { buildBeforeAfterWorkbook, listBeforeAfterExcelPages } from '@/lib/generateBeforeAfterExcel'
import {
  generateGenbafotoJob,
  orderPhotosForGenbafoto,
  type GenbafotoJobV1,
  type GenbafotoPageV1,
  type GenbafotoTemplateType,
} from '@/lib/generateGenbafotoJob'
import { identityPhotos, pairsToPhotos, toGenbafotoPage } from '@/lib/genbafotoPageItems'
import type { Phase, Photo } from '@/types/photo'

function synced(phase: Phase, n: number): Photo[] {
  return Array.from({ length: n }, () => {
    const p = makePhoto(phase)
    return { ...p, storage_path: `user-1/project-1/${p.id}.jpg` } as Photo
  })
}

// 施工前8・施工中4・施工後5（計17枚）。標準は4ページ、大判は7ページ、施工前後は3ページ（組6〜8は施工前のみ）。
const photos = [...synced('before', 8), ...synced('during', 4), ...synced('after', 5)]

async function runJob(target: Photo[], type: GenbafotoTemplateType, page?: GenbafotoPageV1) {
  const downloads: { blob: Blob; filename: string }[] = []
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const { photoIds } = JSON.parse(String(init?.body)) as { photoIds: string[] }
    const body = { expiresAt: '2026-10-12T00:30:00.000Z', photos: photoIds.map((id) => ({ id, imageUrl: `https://example.test/sign/${id}.jpg` })) }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const result = await generateGenbafotoJob(PROJECT, target, type, page, {
    getAccessToken: async () => 'test-access-token',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => new Date('2026-10-12T00:00:00.000Z'),
    download: (blob, filename) => {
      downloads.push({ blob, filename })
    },
  })
  const json = downloads.length ? (JSON.parse(await downloads[0].blob.text()) as GenbafotoJobV1 & Record<string, unknown>) : null
  return { result, json, fetchImpl }
}

/** ExcelExportButton の選択ページ出力と同じ経路 */
function pageJob<T>(page: ExcelPageInfo<T>, type: GenbafotoTemplateType, toPhotos: (items: T[]) => Photo[]) {
  return runJob(toPhotos(page.items), type, toGenbafotoPage(page))
}

const nos = (job: GenbafotoJobV1) => job.photos.map((p) => `${p.phase[0]}${p.no}`).join(' ')

describe('全ページ出力（Pro、またはページ数が1以下）', () => {
  it('標準・大判：no は施工前→施工中→施工後の1からの通し番号、page は付けず、schemaVersion は 1', async () => {
    for (const type of ['standard', 'large'] as const) {
      const { result, json } = await runJob(photos, type)
      expect(result.ok).toBe(true)
      expect(json!.schemaVersion).toBe(1)
      expect('page' in json!).toBe(false)
      expect(json!.photos.map((p) => p.no)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
    }
  })

  it('施工前後：同じ組の施工前・施工後は同じ no（組番号1〜8）、page は付けない', async () => {
    const { result, json } = await runJob(photos, 'beforeAfter')
    expect(result.ok).toBe(true)
    expect(json!.schemaVersion).toBe(1)
    expect('page' in json!).toBe(false)
    expect(nos(json!)).toBe('b1 a1 b2 a2 b3 a3 b4 a4 b5 a5 b6 b7 b8')
  })

  it('orderPhotosForGenbafoto の開始番号を省略すると従来どおり1から', () => {
    expect(orderPhotosForGenbafoto(photos, 'standard').map((o) => o.no)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
  })
})

describe('選択ページ出力（無料・広告削除で総ページ数が2以上）', () => {
  it('標準の2ページ目：no は startNo=7 から（7, 8）、page は {groupIndex:0, startNo:7, endNo:8}', async () => {
    const pages = listStandardExcelPages(photos)
    expect(pages).toHaveLength(4)
    const { result, json } = await pageJob(pages[1], 'standard', identityPhotos)
    expect(result.ok).toBe(true)
    expect(json!.schemaVersion).toBe(1)
    expect(json!.page).toEqual({ groupIndex: 0, startNo: 7, endNo: 8 })
    expect(nos(json!)).toBe('b7 b8')
  })

  it('標準の施工中・施工後のページも、シートをまたいだ続き番号になる', async () => {
    const pages = listStandardExcelPages(photos)
    const during = await pageJob(pages[2], 'standard', identityPhotos)
    expect(during.json!.page).toEqual({ groupIndex: 1, startNo: 9, endNo: 12 })
    expect(nos(during.json!)).toBe('d9 d10 d11 d12')
    const after = await pageJob(pages[3], 'standard', identityPhotos)
    expect(after.json!.page).toEqual({ groupIndex: 2, startNo: 13, endNo: 17 })
    expect(nos(after.json!)).toBe('a13 a14 a15 a16 a17')
  })

  it('標準の1ページ目も page を付ける（全ページ出力と区別できる）', async () => {
    const pages = listStandardExcelPages(photos)
    const { json } = await pageJob(pages[0], 'standard', identityPhotos)
    expect(json!.page).toEqual({ groupIndex: 0, startNo: 1, endNo: 6 })
    expect(nos(json!)).toBe('b1 b2 b3 b4 b5 b6')
  })

  it('大判の途中ページ：施工前2ページ目は 4〜6、施工中2ページ目は 12', async () => {
    const pages = listOneColumnExcelPages(photos)
    expect(pages).toHaveLength(7)
    const p2 = await pageJob(pages[1], 'large', identityPhotos)
    expect(p2.json!.page).toEqual({ groupIndex: 0, startNo: 4, endNo: 6 })
    expect(nos(p2.json!)).toBe('b4 b5 b6')
    const p5 = await pageJob(pages[4], 'large', identityPhotos)
    expect(p5.json!.page).toEqual({ groupIndex: 1, startNo: 12, endNo: 12 })
    expect(nos(p5.json!)).toBe('d12')
  })

  it('施工前後の途中ページ：組4〜6（組6は施工前のみ）、左右は同じ番号', async () => {
    const pages = listBeforeAfterExcelPages(photos)
    expect(pages).toHaveLength(3)
    const { result, json } = await pageJob(pages[1], 'beforeAfter', pairsToPhotos)
    expect(result.ok).toBe(true)
    expect(json!.page).toEqual({ groupIndex: 0, startNo: 4, endNo: 6 })
    expect(nos(json!)).toBe('b4 a4 b5 a5 b6')
  })

  it('施工前後：施工前のみのページ（組7・8）', async () => {
    const pages = listBeforeAfterExcelPages(photos)
    const { json } = await pageJob(pages[2], 'beforeAfter', pairsToPhotos)
    expect(json!.page).toEqual({ groupIndex: 0, startNo: 7, endNo: 8 })
    expect(nos(json!)).toBe('b7 b8')
  })

  it('施工前後：施工後のみの組（施工前2・施工後4の2ページ目＝組4は施工後のみ）', async () => {
    const set = [...synced('before', 2), ...synced('after', 4)]
    const pages = listBeforeAfterExcelPages(set)
    expect(pages).toHaveLength(2)
    const p1 = await pageJob(pages[0], 'beforeAfter', pairsToPhotos)
    expect(nos(p1.json!)).toBe('b1 a1 b2 a2 a3')
    const p2 = await pageJob(pages[1], 'beforeAfter', pairsToPhotos)
    expect(p2.json!.page).toEqual({ groupIndex: 0, startNo: 4, endNo: 4 })
    expect(nos(p2.json!)).toBe('a4')
  })

  it('page の startNo / endNo は Web標準モードのページ情報そのもので、全ページの番号の続きになっている', async () => {
    const all = await runJob(photos, 'standard')
    const byId = new Map(orderPhotosForGenbafoto(photos, 'standard').map((o) => [o.photo.id, o.no]))
    for (const page of listStandardExcelPages(photos)) {
      const { json } = await pageJob(page, 'standard', identityPhotos)
      expect(json!.page).toEqual(toGenbafotoPage(page))
      expect(json!.photos.map((p) => p.no)).toEqual(page.items.map((p) => byId.get(p.id)))
    }
    expect(all.json!.photos).toHaveLength(17)
  })
})

describe('Web標準モードの選択ページ出力と番号が一致する', () => {
  const cellTexts = (ws: { eachRow: (opt: object, cb: (row: { eachCell: (opt: object, cb: (c: { value: unknown }) => void) => void }) => void) => void }) => {
    const texts: string[] = []
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => { if (typeof c.value === 'string' && c.value) texts.push(c.value) }))
    return texts
  }

  it('標準の2ページ目：Web標準モードの No. と .genbafoto の no が同じ（No.7, No.8）', async () => {
    const page = listStandardExcelPages(photos)[1]
    const wb = await buildExcelWorkbook(PROJECT, photos, page)
    const webNos = cellTexts(wb.getWorksheet('施工前') as never).filter((t) => t.startsWith('No.'))
    const { json } = await pageJob(page, 'standard', identityPhotos)
    expect(webNos).toEqual(json!.photos.map((p) => `No.${p.no}`))
  })

  it('施工前後の2ページ目：Web標準モードの「施工前 No.n」「施工後 No.n」と .genbafoto の組番号が同じ', async () => {
    const page = listBeforeAfterExcelPages(photos)[1]
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos, page)
    const webNos = cellTexts(wb.getWorksheet('施工前後') as never).filter((t) => /^施工[前後] No\./.test(t))
    const { json } = await pageJob(page, 'beforeAfter', pairsToPhotos)
    expect(webNos).toEqual(json!.photos.map((p) => `${p.phase === 'before' ? '施工前' : '施工後'} No.${p.no}`))
  })
})

describe('ページ情報の食い違い', () => {
  it('写真とページ情報が一致しない場合は .genbafoto を作らず、API も呼ばない', async () => {
    const page = listStandardExcelPages(photos)[1] // 施工前 7〜8
    const cases: GenbafotoPageV1[] = [
      { groupIndex: 0, startNo: 7, endNo: 9 }, // 枚数と範囲が合わない
      { groupIndex: 1, startNo: 7, endNo: 8 }, // フェーズが違う
      { groupIndex: 0, startNo: 0, endNo: 1 }, // 範囲が不正
    ]
    for (const bad of cases) {
      const { result, json, fetchImpl } = await runJob(identityPhotos(page.items), 'standard', bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('invalid_page')
      expect(json).toBeNull()
      expect(fetchImpl).not.toHaveBeenCalled()
    }
    const ba = await runJob(pairsToPhotos(listBeforeAfterExcelPages(photos)[1].items), 'beforeAfter', { groupIndex: 1, startNo: 4, endNo: 6 })
    expect(ba.result.ok).toBe(false)
  })
})
