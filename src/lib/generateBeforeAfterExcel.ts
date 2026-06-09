import { Workbook } from 'exceljs'
import type { Worksheet } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import {
  type CellFrame,
  BOX,
  tc,
  buildCoverSheet,
  embedImage,
  triggerDownload,
  fmtDate,
  colWidthToPx,
  rowHeightToPx,
} from '@/lib/generateExcel'

// ─── レイアウト定数（標準台帳と同値） ────────────────────────
const ROWS_PER_PAIR = 5
const COL_W         = 28
const H_NO          = 18
const H_IMAGE       = 130
const H_PHASE       = 18
const H_DATE        = 18
const H_COMMENT     = 45

// ─── ペアリング ────────────────────────────────────────────────

type Pair = { before: Photo | undefined; after: Photo | undefined }

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

export async function generateBeforeAfterExcel(
  project: Project,
  photos: Photo[],
): Promise<void> {
  const pairs = pairBeforeAfter(photos)

  const wb = new Workbook()
  wb.creator = '現場フォト'
  wb.created = new Date()

  const totalPhotos = pairs.reduce(
    (n, p) => n + (p.before ? 1 : 0) + (p.after ? 1 : 0),
    0,
  )
  buildCoverSheet(wb, project, totalPhotos, '施工前後写真台帳')
  await buildBeforeAfterSheet(wb, pairs)

  const buffer = await wb.xlsx.writeBuffer()
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerDownload(buffer as ArrayBuffer, `${safeName}_施工前後写真台帳.xlsx`)
}

// ─── 施工前後シート ───────────────────────────────────────────

async function buildBeforeAfterSheet(wb: Workbook, pairs: Pair[]): Promise<void> {
  const ws = wb.addWorksheet('施工前後')
  ws.columns = [{ width: COL_W }, { width: COL_W }]

  ws.pageSetup.paperSize   = 9
  ws.pageSetup.orientation = 'portrait'
  ws.pageSetup.fitToPage   = true
  ws.pageSetup.fitToWidth  = 1
  ws.pageSetup.fitToHeight = 0

  if (pairs.length === 0) {
    const c = ws.getCell('A1')
    c.value = '施工前後の写真がありません'
    c.font  = { italic: true, color: { argb: 'FF999999' } }
    return
  }

  // 列ヘッダー行（施工前 / 施工後）
  buildColumnHeaders(ws)

  for (let i = 0; i < pairs.length; i++) {
    const { before, after } = pairs[i]
    const rNo = i * ROWS_PER_PAIR + 2  // 1行目がヘッダーのため +2

    ws.getRow(rNo + 0).height = H_NO
    ws.getRow(rNo + 1).height = H_IMAGE
    ws.getRow(rNo + 2).height = H_PHASE
    ws.getRow(rNo + 3).height = H_DATE
    ws.getRow(rNo + 4).height = H_COMMENT

    // 番号行（施工前後の区別を明示）
    tc(ws, rNo, 1, before ? `施工前 No.${i + 1}` : '', true, 'center')
    tc(ws, rNo, 2, after  ? `施工後 No.${i + 1}` : '', true, 'center')

    // フェーズ行（常に固定表示）
    tc(ws, rNo+2, 1, before ? '施工前' : '', false, 'center')
    tc(ws, rNo+2, 2, after  ? '施工後' : '', false, 'center')

    // 日付行
    tc(ws, rNo+3, 1, fmtDate(before?.taken_at ?? null), false, 'center')
    tc(ws, rNo+3, 2, fmtDate(after?.taken_at  ?? null), false, 'center')

    // コメント行
    tc(ws, rNo+4, 1, before?.comment ?? '', false, 'left', true)
    tc(ws, rNo+4, 2, after?.comment  ?? '', false, 'left', true)

    // 画像行の枠線（画像埋め込み失敗時の見た目保証）
    ws.getCell(rNo+1, 1).border = BOX
    ws.getCell(rNo+1, 2).border = BOX

    // 画像行は rNo+1（1-indexed）= rNo（0-indexed）
    const imageRow0 = rNo
    const frameBase: Omit<CellFrame, 'col0'> = {
      row0:     imageRow0,
      widthPx:  colWidthToPx(COL_W),
      heightPx: rowHeightToPx(H_IMAGE),
    }
    if (before) await embedImage(wb, ws, before, { col0: 0, ...frameBase })
    if (after)  await embedImage(wb, ws, after,  { col0: 1, ...frameBase })
  }
}

// ─── 列ヘッダー ───────────────────────────────────────────────

function buildColumnHeaders(ws: Worksheet): void {
  ws.getRow(1).height = 22

  const lc = ws.getCell(1, 1)
  lc.value = '施工前'
  lc.font      = { bold: true, size: 10 }
  lc.alignment = { horizontal: 'center', vertical: 'middle' }
  lc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
  lc.border    = BOX

  const rc = ws.getCell(1, 2)
  rc.value = '施工後'
  rc.font      = { bold: true, size: 10 }
  rc.alignment = { horizontal: 'center', vertical: 'middle' }
  rc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFD9' } }
  rc.border    = BOX
}
