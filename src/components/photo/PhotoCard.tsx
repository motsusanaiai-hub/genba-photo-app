import type { Photo } from '@/types/photo'
import { PhaseBadge } from './PhaseBadge'

interface Props {
  photo: Photo
  index: number
  onClick: (photo: Photo) => void
}

export function PhotoCard({ photo, index, onClick }: Props) {
  return (
    <button
      className="relative aspect-square rounded-md overflow-hidden group focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => onClick(photo)}
      aria-label={`写真 ${index + 1}: ${photo.original_filename}`}
    >
      <img
        src={photo.thumbnail_data_url}
        alt={photo.original_filename}
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        loading="lazy"
      />

      {/* 写真番号 */}
      <div className="absolute top-1 left-1 bg-black/60 text-white text-xs rounded px-1.5 py-0.5 font-mono leading-none">
        {String(index + 1).padStart(2, '0')}
      </div>

      {/* フェーズバッジ */}
      {photo.phase && (
        <div className="absolute top-1 right-1">
          <PhaseBadge phase={photo.phase} size="sm" />
        </div>
      )}

      {/* コメントプレビュー（コメントがある場合） */}
      {photo.comment && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1.5 truncate leading-tight">
          {photo.comment}
        </div>
      )}
    </button>
  )
}
