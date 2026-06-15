import { Check } from 'lucide-react'
import type { Photo } from '@/types/photo'
import { PhaseBadge } from './PhaseBadge'
import { useLongPress } from '@/hooks/useLongPress'
import { resolvePhotoThumbUrl } from '@/lib/cloudSync'
import { cn } from '@/lib/utils'

interface Props {
  photo: Photo
  index: number
  onClick: (photo: Photo) => void
  onLongPress?: (photo: Photo) => void
  isSelected?: boolean
  onToggle?: (id: string) => void
  onRangeSelect?: (id: string) => void
}

export function PhotoCard({ photo, index, onClick, onLongPress, isSelected = false, onToggle, onRangeSelect }: Props) {
  const longPress = useLongPress({
    onLongPress: () => onLongPress?.(photo),
    // PC: Shift+クリックで範囲選択、Ctrl/Cmd+クリックで個別選択トグル（プレビューは開かない）
    onClick: (e) => {
      if (e.shiftKey && onRangeSelect) {
        onRangeSelect(photo.id)
        return
      }
      if ((e.ctrlKey || e.metaKey) && onToggle) {
        onToggle(photo.id)
        return
      }
      onClick(photo)
    },
  })

  return (
    <div
      className={cn(
        'group relative aspect-square rounded-md overflow-hidden',
        isSelected && 'ring-2 ring-primary ring-offset-1',
      )}
    >
      {/* 写真本体（タップ → ライトボックス / 長押し → アクションシート） */}
      <button
        className="w-full h-full focus:outline-none focus:ring-2 focus:ring-ring touch-manipulation select-none"
        aria-label={`写真 ${index + 1}: ${photo.original_filename}`}
        {...longPress}
      >
        <img
          src={resolvePhotoThumbUrl(photo)}
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
          onClick={(e) => {
            e.stopPropagation()
            // Shift+クリックは写真本体と同様に範囲選択。Ctrl/Cmd・修飾キーなしは個別トグル
            if (e.shiftKey && onRangeSelect) {
              onRangeSelect(photo.id)
              return
            }
            onToggle(photo.id)
          }}
          className={cn(
            'absolute bottom-1 right-1 h-7 w-7 rounded-full border-2 border-white',
            'flex items-center justify-center transition-all',
            isSelected
              ? 'bg-primary opacity-100'
              : 'bg-black/40 opacity-40 group-hover:opacity-90',
          )}
          aria-label={isSelected ? '選択解除' : '選択'}
          aria-pressed={isSelected}
        >
          {isSelected && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
        </button>
      )}
    </div>
  )
}
