import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseBadge } from './PhaseBadge'
import { TemplateDropdown } from './TemplateDropdown'
import { resolvePhotoThumbUrl } from '@/lib/cloudSync'
import type { Photo } from '@/types/photo'

interface Props {
  photo: Photo
  index: number
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
  onFloorLocationChange: (photoId: string, data: { floor: string; location: string }) => void
  prevComment?: string     // 「上の写真と同じ」用
  onMoveUp?: () => void    // undefined = ボタン非表示（先頭行）
  onMoveDown?: () => void  // undefined = ボタン非表示（末尾行）
  dragHandle?: boolean     // true = ドラッグハンドルを表示（並び替え無効な一覧では非表示）
}

export function LedgerRow({
  photo,
  index,
  onPhotoClick,
  onCommentChange,
  onFloorLocationChange,
  prevComment,
  onMoveUp,
  onMoveDown,
  dragHandle,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id,
  })
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // サムネイルはドラッグハンドルも兼ねるため、実際にドラッグが発生した場合は
  // ドラッグ終了直後に飛んでくるクリックを1回だけ無視してライトボックスが誤って開かないようにする
  const draggedRef = useRef(false)
  useEffect(() => {
    if (isDragging) draggedRef.current = true
  }, [isDragging])

  const handleThumbnailClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    onPhotoClick(photo)
  }

  const [local, setLocal] = useState(photo.comment)
  const [localFloor, setLocalFloor] = useState(photo.floor ?? '')
  const [localLocation, setLocalLocation] = useState(photo.location ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isFirst = useRef(true)
  const isFirstMeta = useRef(true)
  // Ref pattern: callback を deps に入れず常に最新版を参照
  const callbackRef = useRef(onCommentChange)
  callbackRef.current = onCommentChange
  const metaCallbackRef = useRef(onFloorLocationChange)
  metaCallbackRef.current = onFloorLocationChange

  // 400ms デバウンス自動保存
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const t = setTimeout(() => callbackRef.current(photo.id, local), 400)
    return () => clearTimeout(t)
  }, [local, photo.id])

  // 400ms デバウンス自動保存（階数・場所）
  useEffect(() => {
    if (isFirstMeta.current) {
      isFirstMeta.current = false
      return
    }
    const t = setTimeout(
      () => metaCallbackRef.current(photo.id, { floor: localFloor, location: localLocation }),
      400,
    )
    return () => clearTimeout(t)
  }, [localFloor, localLocation, photo.id])

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
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={cn(
        'flex border-b last:border-b-0 bg-background',
        isDragging && 'relative z-10 opacity-60',
      )}
    >
      {/* 番号列（ドラッグハンドル + ▲▼ + 連番） */}
      <div className="w-12 shrink-0 flex flex-col items-center pt-1.5 gap-0.5">
        {dragHandle && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
            aria-label="ドラッグして並び替え"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
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
            onClick={handleThumbnailClick}
            {...(dragHandle ? attributes : undefined)}
            {...(dragHandle ? listeners : undefined)}
            className={cn(
              'shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              dragHandle && 'touch-none cursor-grab active:cursor-grabbing',
            )}
            aria-label={`写真 ${index + 1} を開く（ドラッグして並び替えも可能）`}
          >
            <img
              src={resolvePhotoThumbUrl(photo)}
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

        {/* 中段: 階数・場所入力 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <label
              htmlFor={`floor-${photo.id}`}
              className="text-xs text-muted-foreground shrink-0 cursor-pointer"
            >
              階数
            </label>
            <input
              id={`floor-${photo.id}`}
              type="text"
              value={localFloor}
              onChange={(e) => setLocalFloor(e.target.value)}
              placeholder="例: 2階"
              className="flex-1 text-sm rounded-md border bg-background border-input px-2 py-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-ring transition-colors placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <label
              htmlFor={`location-${photo.id}`}
              className="text-xs text-muted-foreground shrink-0 cursor-pointer"
            >
              場所
            </label>
            <input
              id={`location-${photo.id}`}
              type="text"
              value={localLocation}
              onChange={(e) => setLocalLocation(e.target.value)}
              placeholder="例: 機械室"
              className="flex-1 text-sm rounded-md border bg-background border-input px-2 py-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-ring transition-colors placeholder:text-muted-foreground"
            />
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
