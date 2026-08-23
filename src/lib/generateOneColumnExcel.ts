import { Workbook } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import {
  BOX,
  tc,
  buildCoverSheet,
  embedImage,
  triggerDownload,
  phaseLabel,
  colWidthToPx,
  rowHeightToPx,
  buildExcelPages,
  splitByPhase,
  PHASE_SHEET_NAMES,
  type ExcelPageInfo,
} from '@/lib/generateExcel'

// ─── レイアウト定数 ───────────────────────────────────────────
//
// 「1列3段」= 1ページに写真を縦1列×3段（最大3枚）で大きく配置するレイアウト。
// Book1.xlsx（A〜K列・1段19行・1ページ57行）の構成に合わせている。
//
// 列幅（A〜K, 計108文字=756px=印刷幅7.875in）は、Book1.xlsxの列幅比率
// （A=1.625, B-F=8.75×5, G=12.375, H=1.75, I=8.75, J=8.75, K=7.5, 合計84.5）
// を108文字にスケール（×1.2781）したもの。
//   写真エリア = A〜H（75文字 ≈ 525px）
//   情報パネル = I〜K（33文字 ≈ 231px）
//
// 行高 H_ROW=13.5pt（Book1は15pt統一）で、1段=19行×13.5pt=256.5pt、
// 1ページ=3段=57行=769.5pt ≤ A4印刷可能高さ約805.68pt（11.19in, 余白0.20/0.20/0.25/0.25in）
// となるよう、約36pt(4.5%)の安全マージンを確保しつつ、Book1.xlsxに近い
// 高さを使い切るようにしている
// （写真セルは縦結合のため、自動改ページが結合セルを分割できず段全体が
//   次ページへ押し出される現象を避けるため、一定の余裕を持たせている）。
//
// 情報パネル（I〜K, ROWS_PER_BLOCK行）の行割り:
//   0行目        : 写真No.（I:K結合）
//   1行目        : 階数（ I=ラベル, J:K=値 ）
//   2行目        : 場所（ I=ラベル, J:K=値 ）
//   3行目        : フェーズ（ I=ラベル, J:K=値 ）
//   4〜18行目    : コメント（I:K結合, 折り返し）
//
// 将来「区分」等の項目を追加する場合は、ROW_COMMENT_START / COMMENT_ROWS を
// 調整し見出し行を増やす（ROWS_PER_BLOCK=19は維持し、コメント行数を減らす）。
const ROWS_PER_BLOCK  = 19
const BLOCKS_PER_PAGE = 3
const H_ROW = 13.5 // 全行共通の行高（pt）

const COL_WIDTHS = [2, 11, 11, 11, 11, 11, 16, 2, 11, 11, 11] // A〜K（合計108文字）

const PHOTO_COL_START = 1  // A
const PHOTO_COL_END   = 8  // H
const PHOTO_COLS      = 75 // A〜H の合計文字数

const INFO_COL_START = 9  // I（ラベル列）
const INFO_COL_VALUE = 10 // J（値列の開始）
const INFO_COL_END   = 11 // K

const ROW_NO       = 0
const ROW_FLOOR    = 1
const ROW_LOCATION = 2
const ROW_PHASE    = 3
const ROW_COMMENT_START = 4

// ─── メイン ──────────────────────────────────────────────────

/** 大写真（1×3）のページ一覧を返す（ページ選択UIと生成処理の両方がこれを参照する）。 */
export function listOneColumnExcelPages(photos: Photo[]): ExcelPageInfo<Photo>[] {
  return buildExcelPages(splitByPhase(photos), BLOCKS_PER_PAGE)
}

export async function generateOneColumnExcel(
  project: Project,
  photos: Photo[],
  page?: ExcelPageInfo<Photo>,
): Promise<void> {
  const wb = await buildOneColumnWorkbook(project, photos, page)
  const buffer = await wb.xlsx.writeBuffer()
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerDownload(buffer as ArrayBuffer, `${safeName}_工事写真台帳(大判).xlsx`)
}

/**
 * 大写真（1×3）レイアウトの Workbook を構築する（ZIP出力など他の出力先からも再利用）。
 * pageを指定した場合はそのページ1枚分だけを含むWorkbookを生成する（Free/ads_removed向け）。
 * page省略時は従来通り全ページ・3シートを構築する（Pro向け、既存動作と完全に同じ）。
 */
export async function buildOneColumnWorkbook(
  project: Project,
  photos: Photo[],
  page?: ExcelPageInfo<Photo>,
): Promise<Workbook> {
  const wb = new Workbook()
  wb.creator = '現場フォト'
  wb.created = new Date()

  // 未分類写真（phase が null）はExcel出力対象外
  const [beforePhotos, duringPhotos, afterPhotos] = splitByPhase(photos)
  const totalPhotos = beforePhotos.length + duringPhotos.length + afterPhotos.length

  if (!page) {
    // 従来通り：全ページ・3シートを構築（Pro向け。既存コードと同一の挙動）
    buildCoverSheet(wb, project, totalPhotos)

    // シートをまたいで続き番号にするため、前のシートの枚数を累積オフセットとして渡す
    let photoOffset = 0
    await buildOneColumnSheet(wb, beforePhotos, '施工前', photoOffset)
    photoOffset += beforePhotos.length
    await buildOneColumnSheet(wb, duringPhotos, '施工中', photoOffset)
    photoOffset += duringPhotos.length
    await buildOneColumnSheet(wb, afterPhotos,  '施工後', photoOffset)
  } else {
    // 指定ページ1枚分のみ。表紙の写真枚数は「このExcelに実際に含まれる枚数」にする
    buildCoverSheet(wb, project, page.items.length)
    await buildOneColumnSheet(wb, page.items, PHASE_SHEET_NAMES[page.groupIndex], page.startNo - 1)
  }

  return wb
}

// ─── 写真台帳シート（1列3段, A〜K / 1段19行） ───────────────────

async function buildOneColumnSheet(
  wb: Workbook,
  photos: Photo[],
  sheetName: string,
  photoOffset: number,
): Promise<void> {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = COL_WIDTHS.map((width) => ({ width }))

  ws.pageSetup.paperSize   = 9  // A4
  ws.pageSetup.orientation = 'portrait'
  ws.pageSetup.fitToPage   = true
  ws.pageSetup.fitToWidth  = 1
  ws.pageSetup.fitToHeight = 0
  // 余白（単位: inch）
  ws.pageSetup.margins = {
    left: 0.20, right: 0.20,
    top:  0.25, bottom: 0.25,
    header: 0.1, footer: 0.1,
  }
  // 用紙中央に配置されているように見せる（レイアウト・スケールは変更しない）
  ws.pageSetup.horizontalCentered = true
  ws.pageSetup.verticalCentered   = true

  if (photos.length === 0) {
    const c = ws.getCell('A1')
    c.value = `${sheetName}の写真がありません`
    c.font  = { italic: true, color: { argb: 'FF999999' } }
    return
  }

  // 最後のページも常に 1列×3段 固定になるよう BLOCKS_PER_PAGE の倍数に補完
  const totalBlocks = Math.ceil(photos.length / BLOCKS_PER_PAGE) * BLOCKS_PER_PAGE

  for (let i = 0; i < totalBlocks; i++) {
    // photos 配列の範囲外は undefined（空枠として扱う）
    const photo = photos[i] as Photo | undefined
    const rNo   = i * ROWS_PER_BLOCK + 1  // 1-indexed 開始行（写真セルの先頭行）

    // 行の高さ（空枠でも維持）
    for (let r = 0; r < ROWS_PER_BLOCK; r++) {
      ws.getRow(rNo + r).height = H_ROW
    }

    // 写真No.
    tc(ws, rNo + ROW_NO, INFO_COL_START, photo ? `No.${photoOffset + i + 1}` : '', true, 'center')
    ws.mergeCells(rNo + ROW_NO, INFO_COL_START, rNo + ROW_NO, INFO_COL_END)

    // 階数
    tc(ws, rNo + ROW_FLOOR, INFO_COL_START, '階数', true, 'left')
    tc(ws, rNo + ROW_FLOOR, INFO_COL_VALUE, photo?.floor ?? '', false, 'center')
    ws.mergeCells(rNo + ROW_FLOOR, INFO_COL_VALUE, rNo + ROW_FLOOR, INFO_COL_END)

    // 場所
    tc(ws, rNo + ROW_LOCATION, INFO_COL_START, '場所', true, 'left')
    tc(ws, rNo + ROW_LOCATION, INFO_COL_VALUE, photo?.location ?? '', false, 'center')
    ws.mergeCells(rNo + ROW_LOCATION, INFO_COL_VALUE, rNo + ROW_LOCATION, INFO_COL_END)

    // フェーズ
    tc(ws, rNo + ROW_PHASE, INFO_COL_START, 'フェーズ', true, 'left')
    tc(ws, rNo + ROW_PHASE, INFO_COL_VALUE, phaseLabel(photo), false, 'center')
    ws.mergeCells(rNo + ROW_PHASE, INFO_COL_VALUE, rNo + ROW_PHASE, INFO_COL_END)

    // コメント（上揃え・折り返し）
    const commentCell = ws.getCell(rNo + ROW_COMMENT_START, INFO_COL_START)
    commentCell.value = photo?.comment ?? ''
    commentCell.font  = { size: 9 }
    commentCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    commentCell.border = BOX
    ws.mergeCells(rNo + ROW_COMMENT_START, INFO_COL_START, rNo + ROWS_PER_BLOCK - 1, INFO_COL_END)

    // 写真セル：縦結合し、写真の有無にかかわらず外枠を表示
    ws.mergeCells(rNo, PHOTO_COL_START, rNo + ROWS_PER_BLOCK - 1, PHOTO_COL_END)
    ws.getCell(rNo, PHOTO_COL_START).border = BOX

    // 写真埋め込み（写真がある場合のみ）
    if (photo) {
      await embedImage(wb, ws, photo, {
        col0: PHOTO_COL_START - 1, row0: rNo - 1,
        widthPx:  colWidthToPx(PHOTO_COLS),
        heightPx: rowHeightToPx(ROWS_PER_BLOCK * H_ROW),
      })
    }

    // 3段ごとに改ページ。最後の段は除く。
    if ((i + 1) % BLOCKS_PER_PAGE === 0 && i < totalBlocks - 1) {
      ws.getRow(rNo + ROWS_PER_BLOCK - 1).addPageBreak()
    }
  }
}
