import { Workbook } from 'exceljs'
import type { Border, Worksheet } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { PHASE_CONFIG } from '@/types/photo'
import { photoStorage } from '@/lib/photoStorage'

// ─── レイアウト定数 ───────────────────────────────────────────
//
// A4 印刷領域を最大活用するための寸法設計:
//   余白: left/right 0.20" → 印刷幅 = 8.27-0.40 = 7.87" = 756px (96dpi)
//   余白: top/bottom 0.25" → 印刷高 = 11.69-0.50 = 11.19" = 806pt (72pt/inch)
//
//   COL_W = 54: 2列 × 54 × 7px = 756px → fitToWidth:1 の拡大率≈1.0
//   H_IMAGE = 187: 3段 × (18+187+18+45) = 3×268 = 804pt ≤ 806pt
//
const ROWS_PER_PAIR  = 4   // 番号 / 画像 / フェーズ / コメント
const PAIRS_PER_PAGE = 3   // 1ページあたり 2列×3段 = 最大6枚
const COL_W          = 54  // 列幅（文字数）— A4印刷幅を自然に埋める値
const H_NO           = 18  // 番号行の高さ（pt）
const H_IMAGE        = 187 // 画像行 — A4高さを3段で割り切った残り
const H_PHASE        = 18
const H_COMMENT      = 45

const CELL_PADDING_PX = 4  // 写真枠の上下左右余白

const THIN: Partial<Border> = { style: 'thin' }
export const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }

// ─── セルフレーム ─────────────────────────────────────────────

/**
 * 写真を配置するセル枠の定義。
 * 将来の複数セル結合（複数行・複数列にまたがる枠）に対応できるよう、
 * 物理サイズを px で明示的に保持する設計にしている。
 * 複数セル結合の場合は widthPx / heightPx に合計値を渡すだけで
 * 以降の計算ロジックを変更せずに対応できる。
 */
export interface CellFrame {
  col0: number      // 0-indexed 列インデックス（フレーム左端）
  row0: number      // 0-indexed 行インデックス（フレーム上端）
  widthPx: number   // フレーム幅（px）
  heightPx: number  // フレーム高さ（px）
}

/** Excel 列幅（文字数）→ px。Calibri 11pt 基準: 1文字幅 ≈ 7px */
export function colWidthToPx(charWidth: number): number {
  return Math.round(charWidth * 7)
}

/** Excel 行高さ（pt）→ px。96dpi 基準: 1pt = 96/72 px */
export function rowHeightToPx(heightPt: number): number {
  return Math.round(heightPt * 96 / 72)
}

/**
 * セルフレーム内に画像をアスペクト比維持で収めた表示サイズと
 * 中央寄せ用 EMU オフセットを計算する。
 *
 * nativeColOff / nativeRowOff は ExcelJS の tl に直接渡す EMU 値。
 * col/row 小数指定は ExcelJS が colWidth(=280000) 倍するため EMU にならないため
 * nativeColOff を使う（型定義にないため as unknown キャストが必要）。
 */
export function calcImagePlacement(
  frame: CellFrame,
  naturalW: number | null,
  naturalH: number | null,
): { extW: number; extH: number; nativeColOff: number; nativeRowOff: number } {
  const maxW = frame.widthPx  - CELL_PADDING_PX * 2
  const maxH = frame.heightPx - CELL_PADDING_PX * 2

  let extW: number
  let extH: number

  if (!naturalW || !naturalH) {
    extW = maxW
    extH = maxH
  } else {
    const ratio = Math.min(maxW / naturalW, maxH / naturalH)
    extW = Math.round(naturalW * ratio)
    extH = Math.round(naturalH * ratio)
  }

  const nativeColOff = Math.round(((frame.widthPx - extW) / 2) * 9525)
  const nativeRowOff = Math.round(((frame.heightPx - extH) / 2) * 9525)

  return { extW, extH, nativeColOff, nativeRowOff }
}

// ─── メイン ──────────────────────────────────────────────────

export async function generateExcel(project: Project, photos: Photo[]): Promise<void> {
  const wb = new Workbook()
  wb.creator = '現場フォト'
  wb.created = new Date()

  // 未分類写真（phase が null）はExcel出力対象外
  const beforePhotos = photos.filter((p) => p.phase === 'before')
  const duringPhotos = photos.filter((p) => p.phase === 'during')
  const afterPhotos  = photos.filter((p) => p.phase === 'after')
  const totalPhotos  = beforePhotos.length + duringPhotos.length + afterPhotos.length

  buildCoverSheet(wb, project, totalPhotos)

  // シートをまたいで続き番号にするため、前のシートの枚数を累積オフセットとして渡す
  let photoOffset = 0
  await buildPhotoSheet(wb, beforePhotos, '施工前', photoOffset)
  photoOffset += beforePhotos.length
  await buildPhotoSheet(wb, duringPhotos, '施工中', photoOffset)
  photoOffset += duringPhotos.length
  await buildPhotoSheet(wb, afterPhotos,  '施工後', photoOffset)

  const buffer = await wb.xlsx.writeBuffer()
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerDownload(buffer as ArrayBuffer, `${safeName}_工事写真台帳.xlsx`)
}

// ─── 表紙シート ───────────────────────────────────────────────

export function buildCoverSheet(
  wb: Workbook,
  project: Project,
  photoCount: number,
  sheetTitle = '工事写真台帳',
): void {
  const ws = wb.addWorksheet('表紙')
  ws.columns = [{ width: 14 }, { width: 32 }]

  // タイトル（A1:B1 結合）
  ws.mergeCells('A1:B1')
  const titleCell = ws.getCell('A1')
  titleCell.value = sheetTitle
  titleCell.font  = { bold: true, size: 18, color: { argb: 'FF1F3864' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
  titleCell.border = BOX
  ws.getRow(1).height = 50

  ws.getRow(2).height = 10  // 空白行

  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric',
  })
  const infoRows: [string, string][] = [
    ['工事名',   project.name],
    ['現場',     project.location],
    ['出力日',   today],
    ['写真枚数', `${photoCount} 枚`],
  ]
  infoRows.forEach(([label, value], i) => {
    const r = i + 3
    const lc = ws.getCell(r, 1)
    lc.value = label
    lc.font  = { bold: true }
    lc.alignment = { horizontal: 'right', vertical: 'middle' }
    lc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } }
    lc.border = BOX

    const vc = ws.getCell(r, 2)
    vc.value = value
    vc.alignment = { vertical: 'middle' }
    vc.border = BOX

    ws.getRow(r).height = 24
  })
}

// ─── 写真台帳シート ───────────────────────────────────────────

async function buildPhotoSheet(
  wb: Workbook,
  photos: Photo[],
  sheetName: string,
  photoOffset: number,
): Promise<void> {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [{ width: COL_W }, { width: COL_W }]

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

  if (photos.length === 0) {
    const c = ws.getCell('A1')
    c.value = `${sheetName}の写真がありません`
    c.font  = { italic: true, color: { argb: 'FF999999' } }
    return
  }

  const numPairs   = Math.ceil(photos.length / 2)
  // 最後のページも常に 2列×3段 固定になるよう PAIRS_PER_PAGE の倍数に補完
  const totalPairs = Math.ceil(numPairs / PAIRS_PER_PAGE) * PAIRS_PER_PAGE

  for (let i = 0; i < totalPairs; i++) {
    // photos 配列の範囲外は undefined（空枠として扱う）
    const left  = photos[i * 2] as Photo | undefined
    const right = photos[i * 2 + 1] as Photo | undefined
    const rNo   = i * ROWS_PER_PAIR + 1      // 1-indexed 番号行

    // 行の高さ（空枠でも維持）
    ws.getRow(rNo + 0).height = H_NO
    ws.getRow(rNo + 1).height = H_IMAGE
    ws.getRow(rNo + 2).height = H_PHASE
    ws.getRow(rNo + 3).height = H_COMMENT

    // 番号行：写真がある枠のみ番号表示、空枠は空白
    tc(ws, rNo,   1, left  ? `No.${photoOffset + i * 2 + 1}` : '', true, 'center')
    tc(ws, rNo,   2, right ? `No.${photoOffset + i * 2 + 2}` : '', true, 'center')

    // フェーズ行
    tc(ws, rNo+2, 1, phaseLabel(left),  false, 'center')
    tc(ws, rNo+2, 2, phaseLabel(right), false, 'center')

    // コメント行（折り返しあり）
    tc(ws, rNo+3, 1, left?.comment  ?? '', false, 'left', true)
    tc(ws, rNo+3, 2, right?.comment ?? '', false, 'left', true)

    // 画像行の外枠：写真あり・空枠問わず常に表示
    ws.getCell(rNo+1, 1).border = BOX
    ws.getCell(rNo+1, 2).border = BOX

    // 写真埋め込み（写真がある場合のみ）
    const row0 = i * ROWS_PER_PAIR + 1  // 0-indexed（画像配置用）
    if (left) {
      await embedImage(wb, ws, left, {
        col0: 0, row0,
        widthPx: colWidthToPx(COL_W), heightPx: rowHeightToPx(H_IMAGE),
      })
    }
    if (right) {
      await embedImage(wb, ws, right, {
        col0: 1, row0,
        widthPx: colWidthToPx(COL_W), heightPx: rowHeightToPx(H_IMAGE),
      })
    }

    // 3段（6枚）ごとに改ページ。最後のペアは除く。
    if ((i + 1) % PAIRS_PER_PAGE === 0 && i < totalPairs - 1) {
      ws.getRow(rNo + 3).addPageBreak()
    }
  }
}

// ─── セル書き込みヘルパー ─────────────────────────────────────

export function tc(
  ws: Worksheet,
  row: number,
  col: number,
  value: string,
  bold: boolean,
  align: 'left' | 'center' | 'right',
  wrap = false,
): void {
  const cell = ws.getCell(row, col)
  cell.value = value
  cell.font  = { bold, size: 9 }
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap }
  cell.border = BOX
}

// ─── 画像埋め込み ─────────────────────────────────────────────

/**
 * 写真を CellFrame に収めて埋め込む。
 * frame はテンプレートごとに呼び出し側で構築する。
 */
export async function embedImage(
  wb: Workbook,
  ws: Worksheet,
  photo: Photo,
  frame: CellFrame,
): Promise<void> {
  try {
    const base64 = await photoToJpegBase64(photo)
    if (!base64) return

    const imageId = wb.addImage({ base64, extension: 'jpeg' })
    const { extW, extH, nativeColOff, nativeRowOff } =
      calcImagePlacement(frame, photo.width, photo.height)

    ws.addImage(imageId, {
      tl: {
        nativeCol:    frame.col0,
        nativeRow:    frame.row0,
        nativeColOff,
        nativeRowOff,
      } as unknown as { col: number; row: number },
      ext: { width: extW, height: extH },
      editAs: 'oneCell',
    })
  } catch {
    // 画像埋め込み失敗は無視して出力を継続
  }
}

// ─── 画像変換ユーティリティ ───────────────────────────────────

async function photoToJpegBase64(photo: Photo): Promise<string | null> {
  try {
    // 1st: IndexedDB の 600px 圧縮版を取得
    const compressedBlob = await photoStorage.getCompressedBlob(photo.id)
    if (compressedBlob) {
      return await blobToBase64(compressedBlob)
    }
    // 2nd: 圧縮版がない場合は原本から 600px にリサイズ（既存写真 or 生成失敗時）
    const url = await photoStorage.getObjectURL(photo.id)
    if (url) {
      const b64 = await urlToJpegBase64(url, 600)
      URL.revokeObjectURL(url)
      return b64
    }
    // 3rd: 原本もない場合は thumbnail_data_url にフォールバック
    return await dataUrlToJpegBase64(photo.thumbnail_data_url)
  } catch {
    return null
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function urlToJpegBase64(url: string, maxLong: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio  = Math.min(1, maxLong / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth  * ratio)
      const h = Math.round(img.naturalHeight * ratio)
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = url
  })
}

function dataUrlToJpegBase64(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = () => reject(new Error('DataURL load failed'))
    img.src = dataUrl
  })
}

// ─── その他ヘルパー ───────────────────────────────────────────

function phaseLabel(photo: Photo | undefined): string {
  if (!photo?.phase) return ''
  return PHASE_CONFIG[photo.phase].label
}

export function fmtDate(isoString: string | null): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function triggerDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
