import { Workbook } from 'exceljs'
import type { Border, Worksheet } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { PHASE_CONFIG } from '@/types/photo'
import { photoStorage } from '@/lib/photoStorage'

// ─── レイアウト定数 ───────────────────────────────────────────
const ROWS_PER_PAIR  = 5   // 番号 / 画像 / フェーズ / 日付 / コメント
const PAIRS_PER_PAGE = 3   // 1ページあたり 2列×3段 = 最大6枚
const COL_W          = 32  // 列幅（文字数）— A4横幅を活用するため28→32
const H_NO           = 18  // 番号行の高さ（pt）
const H_IMAGE        = 130 // 画像行の高さ（pt）
const H_PHASE        = 18
const H_DATE         = 18
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
  // 余白を小さくして A4 横幅を最大限活用する（単位: inch）
  ws.pageSetup.margins = {
    left: 0.25, right: 0.25,
    top:  0.30, bottom: 0.30,
    header: 0.1, footer: 0.1,
  }

  if (photos.length === 0) {
    const c = ws.getCell('A1')
    c.value = `${sheetName}の写真がありません`
    c.font  = { italic: true, color: { argb: 'FF999999' } }
    return
  }

  const numPairs = Math.ceil(photos.length / 2)

  for (let i = 0; i < numPairs; i++) {
    const left  = photos[i * 2]
    const right = photos[i * 2 + 1]          // 奇数末尾は undefined
    const rNo   = i * ROWS_PER_PAIR + 1      // 1-indexed 番号行

    // 行の高さ
    ws.getRow(rNo + 0).height = H_NO
    ws.getRow(rNo + 1).height = H_IMAGE
    ws.getRow(rNo + 2).height = H_PHASE
    ws.getRow(rNo + 3).height = H_DATE
    ws.getRow(rNo + 4).height = H_COMMENT

    // 番号行（photoOffset でシートをまたいだ続き番号）
    tc(ws, rNo,   1, `No.${photoOffset + i * 2 + 1}`, true,  'center')
    tc(ws, rNo,   2, right ? `No.${photoOffset + i * 2 + 2}` : '', true, 'center')

    // フェーズ行
    tc(ws, rNo+2, 1, phaseLabel(left),  false, 'center')
    tc(ws, rNo+2, 2, phaseLabel(right), false, 'center')

    // 日付行
    tc(ws, rNo+3, 1, fmtDate(left.taken_at),          false, 'center')
    tc(ws, rNo+3, 2, fmtDate(right?.taken_at ?? null), false, 'center')

    // コメント行（折り返しあり）
    tc(ws, rNo+4, 1, left.comment,         false, 'left', true)
    tc(ws, rNo+4, 2, right?.comment ?? '', false, 'left', true)

    // 画像行にも枠線を設定（画像埋め込み失敗時の見た目保証）
    ws.getCell(rNo+1, 1).border = BOX
    ws.getCell(rNo+1, 2).border = BOX

    // 写真埋め込み（1枚失敗しても他の行は継続）
    const row0 = i * ROWS_PER_PAIR + 1  // 0-indexed（画像配置用）
    await embedImage(wb, ws, left, {
      col0: 0, row0,
      widthPx: colWidthToPx(COL_W), heightPx: rowHeightToPx(H_IMAGE),
    })
    if (right) {
      await embedImage(wb, ws, right, {
        col0: 1, row0,
        widthPx: colWidthToPx(COL_W), heightPx: rowHeightToPx(H_IMAGE),
      })
    }

    // 3段（6枚）ごとに改ページ。No.だけが前ページ末尾に残らないよう
    // コメント行の後ろで切り、次の No. 行から新ページが始まる。
    // 最後のペアには不要なので除外する。
    if ((i + 1) % PAIRS_PER_PAGE === 0 && i < numPairs - 1) {
      ws.getRow(rNo + 4).addPageBreak()
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
