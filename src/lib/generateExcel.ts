import { Workbook } from 'exceljs'
import type { Anchor, Border, Worksheet } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { PHASE_CONFIG } from '@/types/photo'
import { photoStorage } from '@/lib/photoStorage'

// ─── レイアウト定数 ───────────────────────────────────────────
const ROWS_PER_PAIR = 5   // 番号 / 画像 / フェーズ / 日付 / コメント
const COL_W         = 28  // 列幅（文字数）
const H_NO          = 18  // 番号行の高さ（pt）
const H_IMAGE       = 130 // 画像行の高さ（pt）
const H_PHASE       = 18
const H_DATE        = 18
const H_COMMENT     = 45

const THIN: Partial<Border> = { style: 'thin' }
const BOX  = { top: THIN, left: THIN, bottom: THIN, right: THIN }

// ─── メイン ──────────────────────────────────────────────────

export async function generateExcel(project: Project, photos: Photo[]): Promise<void> {
  const wb = new Workbook()
  wb.creator = '現場フォト'
  wb.created = new Date()

  buildCoverSheet(wb, project, photos.length)
  await buildPhotoSheet(wb, photos)

  const buffer = await wb.xlsx.writeBuffer()
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerDownload(buffer as ArrayBuffer, `${safeName}_工事写真台帳.xlsx`)
}

// ─── 表紙シート ───────────────────────────────────────────────

function buildCoverSheet(wb: Workbook, project: Project, photoCount: number): void {
  const ws = wb.addWorksheet('表紙')
  ws.columns = [{ width: 14 }, { width: 32 }]

  // タイトル（A1:B1 結合）
  ws.mergeCells('A1:B1')
  const title = ws.getCell('A1')
  title.value = '工事写真台帳'
  title.font  = { bold: true, size: 18, color: { argb: 'FF1F3864' } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
  title.border = BOX
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

async function buildPhotoSheet(wb: Workbook, photos: Photo[]): Promise<void> {
  const ws = wb.addWorksheet('写真台帳')
  ws.columns = [{ width: COL_W }, { width: COL_W }]

  ws.pageSetup.paperSize      = 9  // A4（const enum は isolatedModules で使えないため数値直指定）
  ws.pageSetup.orientation    = 'portrait'
  ws.pageSetup.fitToPage      = true
  ws.pageSetup.fitToWidth     = 1
  ws.pageSetup.fitToHeight    = 0

  if (photos.length === 0) {
    const c = ws.getCell('A1')
    c.value = '写真がありません'
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

    // 番号行
    tc(ws, rNo,   1, `No.${i * 2 + 1}`, true,  'center')
    tc(ws, rNo,   2, right ? `No.${i * 2 + 2}` : '', true, 'center')

    // フェーズ行
    tc(ws, rNo+2, 1, phaseLabel(left),  false, 'center')
    tc(ws, rNo+2, 2, phaseLabel(right), false, 'center')

    // 日付行
    tc(ws, rNo+3, 1, fmtDate(left.taken_at),         false, 'center')
    tc(ws, rNo+3, 2, fmtDate(right?.taken_at ?? null), false, 'center')

    // コメント行（折り返しあり）
    tc(ws, rNo+4, 1, left.comment,         false, 'left', true)
    tc(ws, rNo+4, 2, right?.comment ?? '', false, 'left', true)

    // 画像行にも枠線を設定（画像埋め込み失敗時の見た目保証）
    ws.getCell(rNo+1, 1).border = BOX
    ws.getCell(rNo+1, 2).border = BOX

    // 写真埋め込み（1枚失敗しても他の行は継続）
    await embedImage(wb, ws, left, i, 0)
    if (right) await embedImage(wb, ws, right, i, 1)
  }
}

// ─── セル書き込みヘルパー ─────────────────────────────────────

function tc(
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

async function embedImage(
  wb: Workbook,
  ws: Worksheet,
  photo: Photo,
  pairIdx: number,
  colIdx: number,  // 0 = 左列, 1 = 右列
): Promise<void> {
  try {
    const base64 = await photoToJpegBase64(photo)
    if (!base64) return

    const imageId = wb.addImage({ base64, extension: 'jpeg' })

    // tl/br は 0-indexed。画像行は 1-indexed (pairIdx*5+2) → 0-indexed (pairIdx*5+1)
    const imgRow0 = pairIdx * ROWS_PER_PAIR + 1
    ws.addImage(imageId, {
      tl: anchor(colIdx,     imgRow0),
      br: anchor(colIdx + 1, imgRow0 + 1),
      editAs: 'twoCell',
    })
  } catch {
    // 画像埋め込み失敗は無視して出力を継続
  }
}

// ─── 画像変換ユーティリティ ───────────────────────────────────

async function photoToJpegBase64(photo: Photo): Promise<string | null> {
  try {
    // IndexedDB からオリジナル画像を取得してリサイズ
    const url = await photoStorage.getObjectURL(photo.id)
    if (url) {
      const b64 = await urlToJpegBase64(url, 800)
      URL.revokeObjectURL(url)
      return b64
    }
    // フォールバック: thumbnail_data_url（WebP → JPEG 変換）
    return await dataUrlToJpegBase64(photo.thumbnail_data_url)
  } catch {
    return null
  }
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

// ExcelJS の型定義は Anchor の全フィールドを要求するが、
// ランタイムは { col, row } のみで動作する。型キャストで吸収する。
function anchor(col: number, row: number): Anchor {
  return { col, row } as unknown as Anchor
}

// ─── その他ヘルパー ───────────────────────────────────────────

function phaseLabel(photo: Photo | undefined): string {
  if (!photo?.phase) return ''
  return PHASE_CONFIG[photo.phase].label
}

function fmtDate(isoString: string | null): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function triggerDownload(buffer: ArrayBuffer, filename: string): void {
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
