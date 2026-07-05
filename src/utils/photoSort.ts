import type { Photo } from '@/types/photo'

export type SortMode = 'taken_at' | 'added' | 'filename'

export const SORT_MODE_OPTIONS: { value: SortMode; label: string; description: string }[] = [
  { value: 'taken_at', label: '撮影順', description: 'EXIF・撮影日時を優先（推奨）' },
  { value: 'added', label: '追加順', description: 'アプリに取り込んだ順番' },
  { value: 'filename', label: '名前順', description: 'ファイル名順' },
]

/** 指定した並び替え条件で並べ替えた写真IDの配列を返す（保存はしない・純粋関数） */
export function sortPhotoIds(photos: Photo[], mode: SortMode): string[] {
  const sorted = [...photos]
  switch (mode) {
    case 'taken_at':
      sorted.sort((a, b) => {
        const at = a.taken_at ? new Date(a.taken_at).getTime() : Number.POSITIVE_INFINITY
        const bt = b.taken_at ? new Date(b.taken_at).getTime() : Number.POSITIVE_INFINITY
        return at - bt || a.created_at.localeCompare(b.created_at)
      })
      break
    case 'added':
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
      break
    case 'filename':
      sorted.sort((a, b) =>
        a.original_filename.localeCompare(b.original_filename, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      )
      break
  }
  return sorted.map((p) => p.id)
}
