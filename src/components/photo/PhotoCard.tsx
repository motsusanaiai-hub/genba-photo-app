import { Check } from 'lucide-react'
import type { Photo } from '@/types/photo'
import { PhaseBadge } from './PhaseBadge'
import { cn } from '@/lib/utils'

interface Props {
  photo: Photo
  index: number
  onClick: (photo: Photo) => void
  isSelected?: boolean
  onToggle?: (id: string) => void
}

export function PhotoCard({ photo, index, onClick, isSelected = false, onToggle }: Props) {
  return (
    <div
      className={cn(
        'group relative aspect-square rounded-md overflow-hidden',
        isSelected && 'ring-2 ring-primary ring-offset-1',
      )}
    >
      {/* 写真本体（タップ → ライトボックス） */}
      <button
        className="w-full h-full focus:outline-none focus:ring-2 focus:ring-ring"
        onClick={() => onClick(photo)}
        aria-label={`写真 ${index + 1}: ${photo.original_filename}`}
      >
        <img
          src={photo.thumbnail_data_url}
          alt={photo.original_filename}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
      </button>

      {/* 選択時の青みオーバーレイ */}
      {isSelected && (
        <div className="absolute inset-0 bg-primary/15 pointer-events-none" />
      )}

      {/* 写真番号 */}
      <div className="absolute top-1 left-1 bg-black/60 text-white text-xs rounded px-1.5 py-0.5 font-mono leading-none pointer-events-none">
        {String(index + 1).padStart(2, '0')}
      </div>

      {/* フェーズバッジ */}
      {photo.phase && (
        <div className="absolute top-1 right-1 pointer-events-none">
          <PhaseBadge phase={photo.phase} size="sm" />
        </div>
      )}

      {/* コメントプレビュー */}
      {photo.comment && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1.5 truncate leading-tight pointer-events-none">
          {photo.comment}
        </div>
      )}

      {/* 選択チェックボックス（右下）
          未選択: 薄表示 → PC ホバーで強調 / モバイルは常時薄表示
          選択中: プライマリ色で常時表示 */}
      {onToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(photo.id) }}
          className={cn(
            'absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full border-2 border-white',
            'flex items-center justify-center transition-all',
            isSelected
              ? 'bg-primary opacity-100'
              : 'bg-black/40 opacity-40 group-hover:opacity-90',
          )}
          aria-label={isSelected ? '選択解除' : '選択'}
          aria-pressed={isSelected}
        >
          {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </button>
      )}
    </div>
  )
}
