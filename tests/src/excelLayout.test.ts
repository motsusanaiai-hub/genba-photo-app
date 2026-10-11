import type { Worksheet } from 'exceljs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_JPEG, PROJECT, cellTexts, installFileReaderPolyfill, makePhotoSet, snapshotSheet } from './excelTestUtils'

// 通常Excel出力（ExcelJS）のレイアウト確認。
//   - Excel出力からフェーズ表示が無くなっていること（アプリ内のフェーズ分類・シート分けは維持）
//   - 旧フェーズ行の高さがコメント欄に割り当てられ、1組・1ページの高さが変わっていないこと
//   - コメントが 左寄せ・上下中央・折り返し・固定高さ であること
//   - 写真枠の寸法・画像のアンカー（twoCellAnchor）・印刷設定・改ページ・1ページの枚数が維持されていること
// 写真の取得元（IndexedDB / Supabase）だけを差し替え、写真の埋め込み・配置計算は本物を通す。

vi.mock('@/lib/photoStorage', () => ({
  photoStorage: { getCompressedBlob: async () => FAKE_JPEG, getObjectURL: async () => null },
}))
vi.mock('@/lib/cloudSync', () => ({ downloadCloudCompressed: async () => null }))

import {
  buildExcelWorkbook,
  calcImagePlacement,
  colWidthToPx,
  listStandardExcelPages,
  rowHeightToPx,
} from '@/lib/generateExcel'
import { buildOneColumnWorkbook } from '@/lib/generateOneColumnExcel'
import { buildBeforeAfterWorkbook, listBeforeAfterExcelPages } from '@/lib/generateBeforeAfterExcel'
import type { Photo } from '@/types/photo'

const PHASE_WORDS = ['施工前', '施工中', '施工後', 'フェーズ']
const A4_MARGINS = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 }
const COMMENT_ALIGNMENT = { horizontal: 'left', vertical: 'middle', wrapText: true }

const photos = makePhotoSet()
const byPhase = (phase: Photo['phase']) => photos.filter((p) => p.phase === phase)

beforeAll(() => {
  installFileReaderPolyfill()
})

function sheet(wb: { getWorksheet: (name: string) => Worksheet | undefined }, name: string): Worksheet {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`sheet not found: ${name}`)
  return ws
}

function expectAnchor(
  image: ReturnType<typeof snapshotSheet>['images'][number],
  expected: ReturnType<typeof calcImagePlacement>,
) {
  expect(image.tl).toEqual(expected.from)
  expect(image.br).toEqual(expected.to)
  expect(image.editAs).toBe('oneCell')
}

// ─── 標準（2×3） ─────────────────────────────────────────────

describe('標準台帳（2×3）', () => {
  const ROWS_PER_PAIR = 3
  const FRAME_W = colWidthToPx(54)
  const FRAME_H = rowHeightToPx(187)

  it('写真シートにフェーズ表示が無い（シート名で施工前・施工中・施工後を分ける構成は維持）', async () => {
    const wb = await buildExcelWorkbook(PROJECT, photos)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['表紙', '施工前', '施工中', '施工後'])
    for (const name of ['施工前', '施工中', '施工後']) {
      const texts = cellTexts(sheet(wb, name))
      expect(texts.filter((t) => PHASE_WORDS.includes(t))).toEqual([])
    }
  }, 30000)

  it('1組 = 番号18pt / 写真187pt / コメント63pt、1ページ（3段）= 804pt', async () => {
    const wb = await buildExcelWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前'))
    const heights = Object.values(snap.rowHeights)
    expect(heights.length % ROWS_PER_PAIR).toBe(0)
    for (let i = 0; i < heights.length; i += ROWS_PER_PAIR) {
      expect(heights.slice(i, i + ROWS_PER_PAIR)).toEqual([18, 187, 63])
    }
    expect(heights.slice(0, ROWS_PER_PAIR * 3).reduce((a, b) => a + b, 0)).toBe(804)
  })

  it('コメントは 左寄せ・上下中央・折り返し で、写真ごとのコメントが入る', async () => {
    const wb = await buildExcelWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前')
    const before = byPhase('before')
    before.forEach((photo, idx) => {
      const pair = Math.floor(idx / 2)
      const cell = ws.getCell(pair * ROWS_PER_PAIR + 3, (idx % 2) + 1)
      expect(cell.value).toBe(photo.comment)
      expect(cell.alignment).toEqual(COMMENT_ALIGNMENT)
    })
  })

  it('写真枠の寸法と画像アンカー（twoCellAnchor）の計算は従来どおりで、行位置だけが1組3行で並ぶ', async () => {
    const wb = await buildExcelWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前'))
    const before = byPhase('before')
    expect(snap.images).toHaveLength(before.length)
    before.forEach((photo, idx) => {
      const pair = Math.floor(idx / 2)
      const expected = calcImagePlacement(
        { col0: idx % 2, row0: pair * ROWS_PER_PAIR + 1, widthPx: FRAME_W, heightPx: FRAME_H },
        photo.width,
        photo.height,
      )
      expectAnchor(snap.images[idx], expected)
    })
    expect(FRAME_W).toBe(378)
    expect(FRAME_H).toBe(249)
  })

  it('A4縦・用紙幅に合わせる・上下左右中央・余白・列幅・改ページ（6枚ごと）', async () => {
    const wb = await buildExcelWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前'))
    expect(snap.pageSetup).toMatchObject({
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: A4_MARGINS,
      // 用紙幅に合わせる縮小で生じる余りを上下左右に均等に振り分ける
      horizontalCentered: true, verticalCentered: true,
    })
    expect(snap.columnWidths).toEqual([54, 54])
    // 施工前7枚 → 4組 → 6組（2ページ）に補完、3組目の最終行（9行目）の後で改ページ
    expect(snap.rowBreaks).toEqual([9])
    expect(Object.keys(snap.rowHeights)).toHaveLength(6 * ROWS_PER_PAIR)
  })

  it('1ページ出力（無料版・広告削除版）でも写真番号を引き継ぎ、同じレイアウトになる', async () => {
    const pages = listStandardExcelPages(photos)
    const page = pages[1] // 施工前の2ページ目（No.7）
    const wb = await buildExcelWorkbook(PROJECT, photos, page)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['表紙', '施工前'])
    const ws = sheet(wb, '施工前')
    expect(ws.getCell(1, 1).value).toBe('No.7')
    expect(ws.getCell(3, 1).value).toBe(page.items[0].comment)
    expect(ws.getCell(3, 1).alignment).toEqual(COMMENT_ALIGNMENT)
    expect(cellTexts(ws).filter((t) => PHASE_WORDS.includes(t))).toEqual([])
  })
})

// ─── 大写真（1×3） ───────────────────────────────────────────

describe('大写真台帳（1×3）', () => {
  const ROWS_PER_BLOCK = 19
  const H_ROW = 13.5

  it('写真シートにフェーズ表示（「フェーズ」ラベルと値）が無い', async () => {
    const wb = await buildOneColumnWorkbook(PROJECT, photos)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['表紙', '施工前', '施工中', '施工後'])
    for (const name of ['施工前', '施工中', '施工後']) {
      expect(cellTexts(sheet(wb, name)).filter((t) => PHASE_WORDS.includes(t))).toEqual([])
    }
  }, 30000)

  it('コメント欄はブロック3行目〜18行目（B:D結合, 16行）で、12pt・左寄せ・上下中央・折り返し', async () => {
    const wb = await buildOneColumnWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前')
    const snap = snapshotSheet(ws)
    byPhase('before').forEach((photo, i) => {
      const r = i * ROWS_PER_BLOCK + 1
      expect(snap.merges).toContain(`B${r + 3}:D${r + 18}`)
      const cell = ws.getCell(r + 3, 2)
      expect(cell.value).toBe(photo.comment)
      expect(cell.alignment).toEqual(COMMENT_ALIGNMENT)
      expect(cell.font?.size).toBe(12)
      // 階数・場所は残る
      expect(ws.getCell(r + 1, 2).value).toBe('階数')
      expect(ws.getCell(r + 2, 2).value).toBe('場所')
    })
  })

  it('1ブロック19行・行高13.5pt・写真セル（A列19行結合）・画像アンカーは従来どおり', async () => {
    const wb = await buildOneColumnWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前'))
    expect(new Set(Object.values(snap.rowHeights))).toEqual(new Set([H_ROW]))
    const before = byPhase('before')
    expect(snap.images).toHaveLength(before.length)
    before.forEach((photo, i) => {
      const r = i * ROWS_PER_BLOCK + 1
      expect(snap.merges).toContain(`A${r}:A${r + 18}`)
      const expected = calcImagePlacement(
        {
          col0: 0, row0: r - 1,
          widthPx: colWidthToPx(75), heightPx: rowHeightToPx(ROWS_PER_BLOCK * H_ROW),
          rowHeightsPx: Array(ROWS_PER_BLOCK).fill(rowHeightToPx(H_ROW)),
        },
        photo.width,
        photo.height,
      )
      expectAnchor(snap.images[i], expected)
    })
  })

  it('A4縦・中央配置・余白・列幅・改ページ（3枚ごと）が維持されている', async () => {
    const wb = await buildOneColumnWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前'))
    expect(snap.pageSetup).toMatchObject({
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: A4_MARGINS, horizontalCentered: true, verticalCentered: true,
    })
    expect(snap.columnWidths).toEqual([75, 11, 11, 11])
    expect(snap.rowBreaks).toEqual([57, 114])
  })
})

// ─── 施工前後比較（標準台帳と共通のレイアウト） ──────────────────

describe('施工前後比較', () => {
  // 列：A＝余白（2文字） / B＝施工前（54） / C＝施工後（54） / D＝余白（2文字）
  const B = 2
  const C = 3
  // 1ページ = 見出し1行 + 3組 × (番号 / 写真 / コメント) = 10行
  const ROWS_PER_PAGE = 10
  const PAIR_HEIGHTS = [18, 187, 63] // 標準台帳と同じ
  const PAGE_ROWS = [22, ...PAIR_HEIGHTS, ...PAIR_HEIGHTS, ...PAIR_HEIGHTS]
  const PRINTABLE_H_PT = (11.69 - 0.25 - 0.25) * 72 // 805.68pt
  const PRINTABLE_W_PT = (8.27 - 0.2 - 0.2) * 72 // 566.64pt

  // 施工前7枚・施工後4枚 → 7組 → 9組（3ページ）に補完
  const pairs = () => listBeforeAfterExcelPages(photos).flatMap((p) => p.items)

  it('毎ページの先頭に見出し（B「施工前」・C「施工後」）があり、フェーズ行・日付は無い', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前後')
    for (let p = 0; p < 3; p++) {
      const top = p * ROWS_PER_PAGE + 1
      expect(ws.getCell(top, B).value).toBe('施工前')
      expect(ws.getCell(top, C).value).toBe('施工後')
      expect(ws.getRow(top).height).toBe(22)
    }
    const extra: string[] = []
    ws.eachRow((row, n) => {
      if ((n - 1) % ROWS_PER_PAGE === 0) return
      row.eachCell((cell) => {
        const v = String(cell.value)
        if (PHASE_WORDS.includes(v) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) extra.push(`${cell.address}=${v}`)
      })
    })
    expect(extra).toEqual([])
  }, 30000)

  it('左（B列）=施工前・右（C列）=施工後、番号は「施工前 No.n」「施工後 No.n」で2ページ目以降も続き番号', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前後')
    pairs().forEach((pair, i) => {
      const rNo = Math.floor(i / 3) * ROWS_PER_PAGE + 2 + (i % 3) * 3
      expect(ws.getCell(rNo, B).value).toBe(pair.before ? `施工前 No.${i + 1}` : '')
      expect(ws.getCell(rNo, C).value).toBe(pair.after ? `施工後 No.${i + 1}` : '')
      expect(ws.getCell(rNo + 2, B).value).toBe(pair.before?.comment ?? '')
      expect(ws.getCell(rNo + 2, C).value).toBe(pair.after?.comment ?? '')
      expect(ws.getCell(rNo + 2, B).alignment).toEqual(COMMENT_ALIGNMENT)
      expect(ws.getCell(rNo + 2, C).alignment).toEqual(COMMENT_ALIGNMENT)
    })
    expect(ws.getCell(2 * ROWS_PER_PAGE + 2, B).value).toBe('施工前 No.7')
    expect(ws.getCell(2 * ROWS_PER_PAGE + 2, C).value).toBe('')
  })

  it('余白列（A・D）は空で、列幅は 2 / 54 / 54 / 2、行は 見出し22 + 3組 × (18 / 187 / 63)pt', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前後')
    const snap = snapshotSheet(ws)
    expect(snap.columnWidths).toEqual([2, 54, 54, 2])
    const spacerValues: string[] = []
    ws.eachRow((row) => {
      for (const col of [1, 4]) {
        const v = row.getCell(col).value
        if (v !== null && v !== undefined && v !== '') spacerValues.push(String(v))
      }
    })
    expect(spacerValues).toEqual([])
    const rows = Object.keys(snap.rowHeights).map(Number).sort((a, b) => a - b)
    expect(rows).toEqual(Array.from({ length: 3 * ROWS_PER_PAGE }, (_, i) => i + 1))
    for (let p = 0; p < 3; p++) {
      const top = p * ROWS_PER_PAGE + 1
      expect(rows.filter((n) => n >= top && n < top + ROWS_PER_PAGE).map((n) => snap.rowHeights[n])).toEqual(PAGE_ROWS)
    }
  })

  it('写真は標準台帳と同じ写真枠・同じ配置計算（twoCellAnchor）で、開始列だけ B（施工前）・C（施工後）', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const snap = snapshotSheet(sheet(wb, '施工前後'))
    const frame = { widthPx: colWidthToPx(54), heightPx: rowHeightToPx(187) }
    const expected: ReturnType<typeof calcImagePlacement>[] = []
    pairs().forEach((pair, i) => {
      const row0 = Math.floor(i / 3) * ROWS_PER_PAGE + 2 + (i % 3) * 3 // 画像行（0-indexed）
      if (pair.before) expected.push(calcImagePlacement({ col0: B - 1, row0, ...frame }, pair.before.width, pair.before.height))
      if (pair.after) expected.push(calcImagePlacement({ col0: C - 1, row0, ...frame }, pair.after.width, pair.after.height))
    })
    expect(snap.images).toHaveLength(expected.length)
    snap.images.forEach((img, i) => expectAnchor(img, expected[i]))
    // 画像は写真枠（1行・1列）の中に収まり、余白列・隣の列・行へはみ出さない
    for (const img of snap.images) {
      expect([B - 1, C - 1]).toContain(img.tl.nativeCol)
      expect(img.br.nativeCol).toBe(img.tl.nativeCol)
      expect(img.br.nativeRow).toBe(img.tl.nativeRow)
    }
  })

  it('印刷設定は標準台帳と同じ（A4縦・用紙の幅に合わせる・縦は自動・余白・上下左右中央）＋印刷範囲 A:D を明示', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const ws = sheet(wb, '施工前後')
    expect(snapshotSheet(ws).pageSetup).toMatchObject({
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: A4_MARGINS,
      horizontalCentered: true, verticalCentered: true,
    })
    expect(ws.pageSetup.printArea).toBe('A$1:D$30')
    expect(snapshotSheet(ws).rowBreaks).toEqual([10, 20])
  })

  it('保存したxlsxのXMLに、印刷範囲 A:D・幅に合わせる（縦は自動）・3組ごとの改ページ・横方向の改ページ無しが書き込まれる', async () => {
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos)
    const buffer = await wb.xlsx.writeBuffer()
    // ExcelJS は読み込み時に改ページを復元しないため、xlsx（zip）内のXMLを直接確認する
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer as ArrayBuffer)
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string')
    const sheetXml = await zip.file('xl/worksheets/sheet2.xml')!.async('string')

    // 行・列とも絶対参照（相対参照だとアクティブセル基準で解釈されるため）
    expect(workbookXml).toContain(
      '<definedName name="_xlnm.Print_Area" localSheetId="1">&apos;施工前後&apos;!$A$1:$D$30</definedName>',
    )
    expect(sheetXml).toContain('<pageSetUpPr fitToPage="1"/>')
    expect(sheetXml).toMatch(/<pageSetup [^>]*fitToWidth="1"[^>]*fitToHeight="0"/)
    expect(sheetXml).toContain('<printOptions horizontalCentered="1" verticalCentered="1"/>')
    expect(sheetXml).toMatch(/<rowBreaks count="2" manualBreakCount="2"><brk id="10"[^>]*man="1"\/><brk id="20"[^>]*man="1"\/><\/rowBreaks>/)
    expect(sheetXml).not.toContain('<colBreaks')
    expect(sheetXml).toContain('<col min="1" max="1" width="2" customWidth="1"/>')
    expect(sheetXml).toContain('<col min="2" max="3" width="54" customWidth="1"/>')
    expect(sheetXml).toContain('<col min="4" max="4" width="2" customWidth="1"/>')
  })

  it('【推定】主な表示倍率でExcelが自動計算する倍率でも、横2列・縦3組が1ページに収まる（実機確認が必要）', () => {
    // Excelの列幅の換算（ECMA-376）：px = trunc(((256 × 文字数 + trunc(128 / MDW)) / 256) × MDW)
    // MDW＝既定フォント（Calibri 11）の数字の幅（px）。DPIごとの値は推定であり、実機の印刷プレビューで確認する。
    const MDW_BY_DPI: Record<number, number> = { 96: 7, 120: 9, 144: 11, 168: 13, 192: 15, 240: 19 }
    const colPx = (chars: number, mdw: number) => Math.trunc(((256 * chars + Math.trunc(128 / mdw)) / 256) * mdw)
    for (const [dpiText, mdw] of Object.entries(MDW_BY_DPI)) {
      const dpi = Number(dpiText)
      const widthPt = ([2, 54, 54, 2].reduce((sum, w) => sum + colPx(w, mdw), 0) * 72) / dpi
      // 「用紙の幅に合わせる」の自動倍率（整数%に切り捨て、100%が上限）
      const scale = Math.min(100, Math.floor((PRINTABLE_W_PT / widthPt) * 100)) / 100
      const step = 72 / dpi // 行高のピクセル丸め
      const pageHeight = PAGE_ROWS.reduce((sum, h) => sum + Math.round(h / step) * step, 0)
      expect(widthPt * scale, `DPI ${dpi}: 幅`).toBeLessThanOrEqual(PRINTABLE_W_PT)
      expect(pageHeight * scale, `DPI ${dpi}: 倍率${Math.round(scale * 100)}% 高さ`).toBeLessThanOrEqual(PRINTABLE_H_PT)
    }
  })

  it('1ページ出力（無料版・広告削除版）でも3組・見出し・続き番号・同じ印刷設定・印刷範囲 A:D', async () => {
    const pages = listBeforeAfterExcelPages(photos)
    expect(pages.map((p) => p.items.length)).toEqual([3, 3, 1])
    const wb = await buildBeforeAfterWorkbook(PROJECT, photos, pages[1])
    const ws = sheet(wb, '施工前後')
    const snap = snapshotSheet(ws)
    expect(ws.getCell(1, B).value).toBe('施工前')
    expect(ws.getCell(2, B).value).toBe('施工前 No.4')
    expect(ws.getCell(8, B).value).toBe('施工前 No.6')
    expect(snap.rowBreaks).toEqual([])
    expect(Object.keys(snap.rowHeights)).toHaveLength(ROWS_PER_PAGE)
    expect(snap.pageSetup).toMatchObject({ fitToPage: true, fitToWidth: 1, fitToHeight: 0 })
    expect(ws.pageSetup.printArea).toBe('A$1:D$10')
  })
})
