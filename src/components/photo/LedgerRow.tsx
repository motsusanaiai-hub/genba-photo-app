import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseBadge } from './PhaseBadge'
import { TemplateDropdown } from './TemplateDropdown'
import type { Photo } from '@/types/photo'

interface Props {
  photo: Photo
  index: number
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
  prevComment?: string    // 「上の写真と同じ」用
  onMoveUp?: () => void   // undefined = ボタン非表示（先頭行）
  onMoveDown?: () => void // undefined = ボタン非表示（末尾行）
}

export function LedgerRow({
  photo,
  index,
  onPhotoClick,
  onCommentChange,
  prevComment,
  onMoveUp,
  onMoveDown,
}: Props) {
  const [local, setLocal] = useState(photo.comment)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isFirst = useRef(true)
  // Ref pattern: callback を deps に入れず常に最新版を参照
  const callbackRef = useRef(onCommentChange)
  callbackRef.current = onCommentChange

  // 400ms デバウンス自動保存
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const t = setTimeout(() => callbackRef.current(photo.id, local), 400)
    return () => clearTimeout(t)
  }, [local, photo.id])

  // テキストエリア高さ自動伸縮
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
      {/* 番号列（▲▼ + 連番） */}
      <div className="w-12 shrink-0 flex flex-col items-center pt-1.5 gap-0.5">
        {onMoveUp ? (
          <button
            type="button"
            onClick={onMoveUp}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="1つ上に移動"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="h-5" />
        )}

        <span className="text-xs font-mono text-muted-foreground select-none leading-none py-0.5">
          {String(index + 1).padStart(2, '0')}
        </span>

        {onMoveDown ? (
          <button
            type="button"
            onClick={onMoveDown}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="1つ下に移動"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="h-5" />
        )}
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

        {/* 下段: コメント入力 + テンプレートボタン */}
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
          {/* テンプレートドロップダウン */}
          <TemplateDropdown
            currentText={local}
            phase={photo.phase}
            prevComment={prevComment}
            onSelect={(text) => setLocal(text)}
          />
        </div>
      </div>
    </div>
  )
}
