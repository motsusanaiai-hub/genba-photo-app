import type { Workbook, Worksheet } from 'exceljs'
import type { Phase, Photo } from '@/types/photo'
import type { Project } from '@/types/project'

// Excel 出力（ExcelJS）のレイアウトテスト用の共通ヘルパー。
// ファイル名が *.test.ts ではないため、それ自体はテストとして実行されない。

/**
 * Node 環境には FileReader が無いため、generateExcel.ts の blobToBase64 が使う
 * readAsDataURL だけを最小限で用意する（写真埋め込み処理そのものは本物を通す）。
 */
export function installFileReaderPolyfill(): void {
  if ('FileReader' in globalThis) return
  class NodeFileReader {
    result: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`
          this.onload?.()
        })
        .catch(() => this.onerror?.())
    }
  }
  ;(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader
}

/** 写真の中身。ExcelJS は画像の中身を検証しないため、JPEG の先頭バイトだけでよい。 */
export const FAKE_JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])], { type: 'image/jpeg' })

export const PROJECT: Project = {
  id: 'project-1',
  user_id: 'user-1',
  name: 'テスト工事',
  location: 'テスト現場',
  start_date: null,
  end_date: null,
  status: 'active',
  cover_photo_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as Project

let seq = 0

export function makePhoto(phase: Phase | null, overrides: Partial<Photo> = {}): Photo {
  seq += 1
  return {
    id: `photo-${seq}`,
    project_id: 'project-1',
    user_id: 'user-1',
    original_filename: `p${seq}.jpg`,
    file_size: 1000,
    width: 4000,
    height: 3000,
    taken_at: '2026-03-04T05:06:07.000Z',
    comment: `コメント${seq}`,
    floor: '2階',
    location: '機械室',
    sort_order: seq,
    phase,
    folder_id: null,
    storage_path: null,
    thumbnail_data_url: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Photo
}

/** 横長・縦長・寸法不明を混ぜた写真（写真配置の計算経路をすべて通すため） */
export function makePhotoSet(): Photo[] {
  seq = 0
  const dims: Array<[number | null, number | null]> = [[4000, 3000], [3000, 4000], [null, null], [1920, 1080]]
  const photos: Photo[] = []
  const add = (phase: Phase, n: number) => {
    for (let i = 0; i < n; i++) {
      const [width, height] = dims[photos.length % dims.length]
      photos.push(makePhoto(phase, { width, height }))
    }
  }
  add('before', 7) // 標準: 2ページ目にまたがる / 大写真: 3ページ目まで
  add('during', 2)
  add('after', 4)
  photos.push(makePhoto(null)) // 未分類は出力対象外
  return photos
}

export interface AnchorSnapshot {
  nativeCol: number
  nativeColOff: number
  nativeRow: number
  nativeRowOff: number
}

export interface SheetSnapshot {
  name: string
  pageSetup: Record<string, unknown>
  columnWidths: Array<number | undefined>
  rowHeights: Record<number, number>
  merges: string[]
  rowBreaks: number[]
  images: Array<{ tl: AnchorSnapshot; br: AnchorSnapshot; editAs: string | undefined }>
}

function anchor(a: unknown): AnchorSnapshot {
  const x = a as AnchorSnapshot
  return { nativeCol: x.nativeCol, nativeColOff: x.nativeColOff, nativeRow: x.nativeRow, nativeRowOff: x.nativeRowOff }
}

export function snapshotSheet(ws: Worksheet): SheetSnapshot {
  const ps = ws.pageSetup
  const rowHeights: Record<number, number> = {}
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (row.height !== undefined) rowHeights[n] = row.height
  })
  const model = ws.model as unknown as { merges?: string[] }
  const breaks = (ws as unknown as { rowBreaks?: Array<{ id: number }> }).rowBreaks ?? []
  return {
    name: ws.name,
    pageSetup: {
      paperSize: ps.paperSize,
      orientation: ps.orientation,
      fitToPage: ps.fitToPage,
      fitToWidth: ps.fitToWidth,
      fitToHeight: ps.fitToHeight,
      scale: ps.scale,
      margins: ps.margins,
      horizontalCentered: ps.horizontalCentered,
      verticalCentered: ps.verticalCentered,
    },
    columnWidths: (ws.columns ?? []).map((c) => c.width),
    rowHeights,
    merges: [...(model.merges ?? [])].sort(),
    rowBreaks: breaks.map((b) => b.id),
    images: ws.getImages().map((img) => ({
      tl: anchor(img.range.tl),
      br: anchor(img.range.br),
      editAs: (img.range as unknown as { editAs?: string }).editAs,
    })),
  }
}

export function snapshotWorkbook(wb: Workbook): SheetSnapshot[] {
  return wb.worksheets.map(snapshotSheet)
}

/** シート内の全セルの値（文字列化）を返す。フェーズ表示が残っていないかの確認に使う。 */
export function cellTexts(ws: Worksheet): string[] {
  const texts: string[] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') texts.push(String(cell.value))
    })
  })
  return texts
}
