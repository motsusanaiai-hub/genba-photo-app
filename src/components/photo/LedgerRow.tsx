import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { cn } from '@/lib/utils'
import { PhaseBadge } from './PhaseBadge'
import type { Photo } from '@/types/photo'

interface Props {
  photo: Photo
  index: number
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
}

export function LedgerRow({ photo, index, onPhotoClick, onCommentChange }: Props) {
  const [local, setLocal] = useState(photo.comment)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isFirst = useRef(true)
  // Ref pattern: keeps callback fresh without adding it to effect deps
  const callbackRef = useRef(onCommentChange)
  callbackRef.current = onCommentChange

  // Debounced auto-save: fires 400ms after last keystroke
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const t = setTimeout(() => callbackRef.current(photo.id, local), 400)
    return () => clearTimeout(t)
  }, [local, photo.id])

  // Auto-resize textarea to content height
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [local])

  const takenAt = photo.taken_at
    ? new Date(photo.taken_at).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  const isEmpty = !local.trim()

  return (
    <div className="flex border-b last:border-b-0">
      {/* 番号列 */}
      <div className="w-9 lg:w-11 shrink-0 flex items-start justify-center pt-3.5">
        <span className="text-xs font-mono text-muted-foreground select-none">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>

      {/* メイン列 */}
      <div className="flex-1 py-2.5 pr-3 space-y-2 min-w-0">
        {/* 上段: サムネイル + メタ情報 */}
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={() => onPhotoClick(photo)}
            className="shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            aria-label={`写真 ${index + 1} を開く`}
          >
            <img
              src={photo.thumbnail_data_url}
              alt={photo.original_filename}
              className="w-full h-full object-cover hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </button>

          <div className="flex-1 min-w-0 pt-0.5 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <PhaseBadge phase={photo.phase} size="sm" />
              {takenAt && (
                <span className="text-xs text-muted-foreground">{takenAt}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate leading-none">
              {photo.original_filename}
            </p>
          </div>
        </div>

        {/* 下段: コメント入力 */}
        <div className="flex items-start gap-2">
          <label
            htmlFor={`comment-${photo.id}`}
            className="text-xs text-muted-foreground shrink-0 pt-[9px] leading-none cursor-pointer"
          >
            コメント
          </label>
          <textarea
            id={`comment-${photo.id}`}
            ref={textareaRef}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="コメントを入力..."
            rows={2}
            className={cn(
              'flex-1 text-sm rounded-md border px-2.5 py-1.5 resize-none min-h-[52px]',
              'focus:outline-none focus:ring-1 focus:ring-ring transition-colors',
              'placeholder:text-muted-foreground',
              isEmpty
                ? 'bg-amber-50 border-amber-200 focus:ring-amber-400'
                : 'bg-background border-input',
            )}
          />
        </div>
      </div>
    </div>
  )
}
