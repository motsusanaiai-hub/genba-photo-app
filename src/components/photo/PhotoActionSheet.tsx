import { CheckSquare, Layers, Trash2 } from 'lucide-react'
import { PhaseBadge } from './PhaseBadge'
import { PHASE_OPTIONS, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'
import { cn } from '@/lib/utils'

interface Props {
  photo: Photo
  onClose: () => void
  onSetPhase: (phase: Phase | null) => void
  onUseAsOverlayBase: () => void
  onStartSelection: () => void
  onDelete: () => void
}

/** 写真の長押しで開くボトムアクションシート */
export function PhotoActionSheet({ photo, onClose, onSetPhase, onUseAsOverlayBase, onStartSelection, onDelete }: Props) {
  const handleDelete = () => {
    if (window.confirm('この写真を削除しますか？\nこの操作は取り消せません。')) {
      onDelete()
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center lg:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-background w-full max-w-md rounded-t-2xl lg:rounded-2xl shadow-xl pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* 対象写真 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <img
            src={photo.thumbnail_data_url}
            alt={photo.original_filename}
            className="h-12 w-12 rounded-md object-cover shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{photo.original_filename}</p>
            <div className="mt-0.5">
              {photo.phase ? (
                <PhaseBadge phase={photo.phase} size="sm" />
              ) : (
                <span className="text-xs text-muted-foreground">未分類</span>
              )}
            </div>
          </div>
        </div>

        {/* フェーズ変更 */}
        <div className="px-4 py-3 border-b">
          <p className="text-xs text-muted-foreground mb-2">フェーズを変更</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PHASE_OPTIONS.map(({ value, label }) => (
              <button
                key={label}
                onClick={() => onSetPhase(value)}
                className={cn(
                  'py-2 rounded-lg border text-xs font-medium transition-colors active:scale-95',
                  value === photo.phase
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* アクション */}
        <div className="py-1">
          <button
            onClick={onUseAsOverlayBase}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
          >
            <Layers className="h-4 w-4 text-muted-foreground" />
            半透明撮影の基準にする
          </button>
          <button
            onClick={onStartSelection}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
          >
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            複数選択を開始
          </button>
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/5 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            削除
          </button>
        </div>

        {/* キャンセル */}
        <div className="border-t px-4 py-2">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
