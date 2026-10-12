import { Workbook } from 'exceljs'
import type { Worksheet } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { excelLedgerFileName } from '@/lib/excelFileName'
import {
  type CellFrame,
  type ExcelPageInfo,
  BOX,
  STANDARD_PAIR_LAYOUT,
  tc,
  buildCoverSheet,
  embedImage,
  triggerDownload,
  colWidthToPx,
  rowHeightToPx,
  buildExcelPages,
} from '@/lib/generateExcel'

// ─── レイアウト（標準台帳と共通） ───────────────────────────────
//
// 施工前後比較は、標準台帳（2列×3段）と同じ写真枠・コメント欄で、左列=施工前・右列=施工後に
// 並べる。1組の寸法（番号18pt / 写真187pt / コメント63pt、列幅54文字）は標準台帳の定数を
// そのまま使い、写真の埋め込み（embedImage → calcImagePlacement の twoCellAnchor）も
// 標準台帳と同じ関数・同じ写真枠で行う（縦横比・アンカーの計算は共通）。
//
// 1ページの構成：
//   見出し行（22pt、左「施工前」・右「施工後」） ← 毎ページ先頭に置く
//   1組目：番号（「施工前 No.n」「施工後 No.n」） / 写真 / コメント
//   2組目・3組目：同上
// 撮影日付は表示しない（以前の専用レイアウトの日付行は廃止）。
//
// ※ 高互換出力（Windows Helper 1.1.0）のテンプレートも同じレイアウト（日付行なし）。
//   Helper 1.0.0 のテンプレートだけが以前の専用レイアウト（日付行あり）のまま。
const { ROWS_PER_PAIR, COL_W, H_NO, H_IMAGE, H_COMMENT } = STANDARD_PAIR_LAYOUT
const H_HEADER        = 22 // 見出し行（施工前 / 施工後）
const PAIRS_PER_PAGE  = 3  // 1ページ3組（写真6枚）
const ROWS_PER_PAGE   = 1 + PAIRS_PER_PAGE * ROWS_PER_PAIR // 見出し1行 + 3組×3行 = 10行

// ─── 列構成・印刷倍率 ───────────────────────────────────────────
//
// 列：A＝余白（空） / B＝施工前（54文字） / C＝施工後（54文字） / D＝余白（空）
//
// 印刷は標準台帳と同じ「用紙の幅に合わせる（縦は自動）」とし、倍率は Excel に自動計算させる。
// Excel の列幅（文字数指定）は表示倍率（DPI）で実際の幅が数%変わるため、固定倍率では
// 環境によって右列（施工後）が次のページへはみ出すことがある（97%固定で実機発生）。
// 「幅に合わせる」なら横2列は環境に関係なく必ず1ページに収まる。
//
// ただし施工前後比較は毎ページ見出し行（22pt）が加わり、1ページ = 22 + 3組×268 = 826pt と
// A4の印刷高（805.68pt）より高い。写真列だけでは自動倍率が約99%になり縦が収まらないため、
// 左右に空の余白列（各2文字）を足して、自動倍率が必ず 96% 前後以下になるようにする。
//   100%表示（96 DPI）：A〜D = 14 + 378 + 378 + 14 = 784px → 印刷幅 755.52px → 自動倍率 約96%
//                        → 826pt × 0.96 = 793pt ≤ 805.68pt（表示倍率が高い環境ほど倍率は下がる）
// 余白列は値を持たない列のため、印刷範囲（A:D）を明示して必ず倍率計算に含める。
// 改ページは3組ごと（各ページの最終行＝3組目のコメント行の後）に明示的に入れる
// （縦を自動にした「幅に合わせる」では手動改ページが有効。大写真台帳と同じ方式）。
const SPACER_W   = 2 // 左右の余白列（文字数）
const COL_BEFORE = 2 // B列（1-indexed）
const COL_AFTER  = 3 // C列（1-indexed）
const LAST_COL   = 'D'

// ─── ペアリング ────────────────────────────────────────────────

export type Pair = { before: Photo | undefined; after: Photo | undefined }

/**
 * before / after それぞれを sort_order 昇順で並べ、
 * 同じインデックス同士をペアにして返す。
 * during 写真はこのテンプレートの対象外として除外する。
 * 枚数が異なる場合は少ない側が undefined になる。
 */
function pairBeforeAfter(photos: Photo[]): Pair[] {
  const befores = photos
    .filter((p) => p.phase === 'before')
    .sort((a, b) => a.sort_order - b.sort_order)
  const afters = photos
    .filter((p) => p.phase === 'after')
    .sort((a, b) => a.sort_order - b.sort_order)
  const len = Math.max(befores.length, afters.length)
  return Array.from({ length: len }, (_, i) => ({
    before: befores[i],
    after:  afters[i],
  }))
}

// ─── メイン ──────────────────────────────────────────────────

/** ペア内の実際の写真枚数（ペア数ではなく写真枚数）を数える。表紙の枚数表示に使う。 */
function countPhotosInPairs(pairs: Pair[]): number {
  return pairs.reduce((n, p) => n + (p.before ? 1 : 0) + (p.after ? 1 : 0), 0)
}

/** 施工前後のページ一覧を返す（ページ選択UIと生成処理の両方がこれを参照する）。 */
export function listBeforeAfterExcelPages(photos: Photo[]): ExcelPageInfo<Pair>[] {
  return buildExcelPages([pairBeforeAfter(photos)], PAIRS_PER_PAGE)
}

export async function generateBeforeAfterExcel(
  project: Project,
  photos: Photo[],
  page?: ExcelPageInfo<Pair>,
): Promise<void> {
  const wb = await buildBeforeAfterWorkbook(project, photos, page)
  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(buffer as ArrayBuffer, excelLedgerFileName(project.name, 'beforeAfter'))
}

/**
 * 前後比較レイアウトの Workbook を構築する（ZIP出力など他の出力先からも再利用）。
 * pageを指定した場合はそのページ（PAIRS_PER_PAGE組）分だけを含むWorkbookを生成する
 * （Free/ads_removed向け。番号はpage.startNoを引き継ぐため1から振り直されない）。
 * page省略時は従来通り全ページを構築する（Pro向け、既存動作と完全に同じ）。
 */
export async function buildBeforeAfterWorkbook(
  project: Project,
  photos: Photo[],
  page?: ExcelPageInfo<Pair>,
): Promise<Workbook> {
  const pairs = pairBeforeAfter(photos)

  const wb = new Workbook()
  wb.creator = '現場フォト'
  wb.created = new Date()

  if (!page) {
    // 従来通り：全ページ（Pro向け。既存コードと同一の挙動。pairOffset=0固定）
    const totalPhotos = countPhotosInPairs(pairs)
    buildCoverSheet(wb, project, totalPhotos, '施工前後写真台帳')
    await buildBeforeAfterSheet(wb, pairs)
  } else {
    // 指定ページ（PAIRS_PER_PAGE組）分のみ。表紙の写真枚数は
    // 「このExcelに実際に含まれる枚数」（ペア数ではなく写真枚数）にする
    const pagePhotoCount = countPhotosInPairs(page.items)
    buildCoverSheet(wb, project, pagePhotoCount, '施工前後写真台帳')
    await buildBeforeAfterSheet(wb, page.items, page.startNo - 1)
  }

  return wb
}

// ─── 施工前後シート ───────────────────────────────────────────

/**
 * pairOffsetは「このpairs配列の先頭が、全体の中で何番目のペアか（0始まり）」。
 * 省略時は0で、全ページ出力（Pro）時は常にpairs全件＋pairOffset=0のため、
 * 既存の「i+1」という採番と完全に同じ結果になる。
 */
async function buildBeforeAfterSheet(wb: Workbook, pairs: Pair[], pairOffset = 0): Promise<void> {
  const ws = wb.addWorksheet('施工前後')
  // A＝余白 / B＝施工前 / C＝施工後 / D＝余白（上の「列構成・印刷倍率」参照）
  ws.columns = [{ width: SPACER_W }, { width: COL_W }, { width: COL_W }, { width: SPACER_W }]

  // 印刷設定は標準台帳と同じ（A4縦・用紙の幅に合わせる・縦は自動・余白・上下左右中央）
  ws.pageSetup.paperSize   = 9
  ws.pageSetup.orientation = 'portrait'
  ws.pageSetup.fitToPage   = true
  ws.pageSetup.fitToWidth  = 1
  ws.pageSetup.fitToHeight = 0
  // 余白（単位: inch）— 標準台帳（generateExcel.ts）と同じ値
  ws.pageSetup.margins = {
    left: 0.20, right: 0.20,
    top:  0.25, bottom: 0.25,
    header: 0.1, footer: 0.1,
  }
  ws.pageSetup.horizontalCentered = true
  ws.pageSetup.verticalCentered   = true

  if (pairs.length === 0) {
    const c = ws.getCell('A1')
    c.value = '施工前後の写真がありません'
    c.font  = { italic: true, color: { argb: 'FF999999' } }
    return
  }

  // 最後のページも常に PAIRS_PER_PAGE 組固定になるよう倍数に補完（はみ出し分は空枠）
  const totalPairs = Math.ceil(pairs.length / PAIRS_PER_PAGE) * PAIRS_PER_PAGE
  const totalPages = totalPairs / PAIRS_PER_PAGE

  for (let p = 0; p < totalPages; p++) {
    const pageTop = p * ROWS_PER_PAGE + 1 // 1-indexed：このページの見出し行

    // 見出し行（毎ページ先頭）
    buildColumnHeaders(ws, pageTop)

    for (let k = 0; k < PAIRS_PER_PAGE; k++) {
      const i = p * PAIRS_PER_PAGE + k
      // pairs配列の範囲外は undefined（空枠として扱う）
      const pair   = pairs[i] as Pair | undefined
      const before = pair?.before
      const after  = pair?.after
      const rNo    = pageTop + 1 + k * ROWS_PER_PAIR // 1-indexed：この組の番号行

      // 行の高さ（標準台帳と同じ。コメント行も固定高さで、内容に応じた自動調整はしない）
      ws.getRow(rNo + 0).height = H_NO
      ws.getRow(rNo + 1).height = H_IMAGE
      ws.getRow(rNo + 2).height = H_COMMENT

      // 番号行（施工前後の区別を明示）。2ページ目以降も続き番号。
      // pairOffset=0（全ページ出力時）は「i+1」、1ページ出力時は page.startNo から続く番号になる
      tc(ws, rNo, COL_BEFORE, before ? `施工前 No.${pairOffset + i + 1}` : '', true, 'center')
      tc(ws, rNo, COL_AFTER,  after  ? `施工後 No.${pairOffset + i + 1}` : '', true, 'center')

      // コメント行（標準台帳と同じ：横は左寄せ / 縦は中央 / 折り返しあり）
      tc(ws, rNo + 2, COL_BEFORE, before?.comment ?? '', false, 'left', true)
      tc(ws, rNo + 2, COL_AFTER,  after?.comment  ?? '', false, 'left', true)

      // 画像行の枠線（画像埋め込み失敗時の見た目保証）
      ws.getCell(rNo + 1, COL_BEFORE).border = BOX
      ws.getCell(rNo + 1, COL_AFTER).border  = BOX

      // 写真枠は標準台帳と同じ（1列 × 画像行1行、twoCellAnchor）。列の開始位置だけ B / C 列にする。
      // 画像行 rNo+1（1-indexed）= rNo（0-indexed）、col0 は 0-indexed（B=1, C=2）
      const frameBase: Omit<CellFrame, 'col0'> = {
        row0:     rNo,
        widthPx:  colWidthToPx(COL_W),
        heightPx: rowHeightToPx(H_IMAGE),
      }
      if (before) await embedImage(wb, ws, before, { col0: COL_BEFORE - 1, ...frameBase })
      if (after)  await embedImage(wb, ws, after,  { col0: COL_AFTER - 1,  ...frameBase })
    }

    // 3組ごとに改ページ（このページの最終行＝3組目のコメント行の後）。最後のページは除く。
    if (p < totalPages - 1) {
      ws.getRow(pageTop + ROWS_PER_PAGE - 1).addPageBreak()
    }
  }

  // 印刷範囲を明示（値を持たない余白列 A・D も必ず印刷範囲＝倍率計算に含める）。
  // ExcelJS は各端の先頭に `$` を付けるだけ（"A1:D30" → "$A1:$D30"）で行が相対参照になるため、
  // 行側に `$` を付けて渡し、XML上で完全な絶対参照 "$A$1:$D$30" にする。
  ws.pageSetup.printArea = `A$1:${LAST_COL}$${totalPages * ROWS_PER_PAGE}`
}

// ─── 見出し行（毎ページ） ─────────────────────────────────────

function buildColumnHeaders(ws: Worksheet, row: number): void {
  ws.getRow(row).height = H_HEADER

  const lc = ws.getCell(row, COL_BEFORE)
  lc.value = '施工前'
  lc.font      = { bold: true, size: 10 }
  lc.alignment = { horizontal: 'center', vertical: 'middle' }
  lc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
  lc.border    = BOX

  const rc = ws.getCell(row, COL_AFTER)
  rc.value = '施工後'
  rc.font      = { bold: true, size: 10 }
  rc.alignment = { horizontal: 'center', vertical: 'middle' }
  rc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFD9' } }
  rc.border    = BOX
}
