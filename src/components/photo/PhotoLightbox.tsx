import { useEffect, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { photoStorage } from '@/lib/photoStorage'
import { PhaseBadge } from './PhaseBadge'
import type { Photo } from '@/types/photo'
import { formatDate } from '@/utils/dateUtils'

interface Props {
  photo: Photo
  photos: Photo[]      // 現在のフィルタ後一覧（ナビゲーション用）
  onClose: () => void
  onChange: (photo: Photo) => void
  onDelete?: (photoId: string) => void
}

export function PhotoLightbox({ photo, photos, onClose, onChange, onDelete }: Props) {
  const [imageURL, setImageURL] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const currentIndex = photos.findIndex((p) => p.id === photo.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < photos.length - 1

  // オリジナル画像を IndexedDB から取得。なければサムネイルを表示
  useEffect(() => {
    let revoke: string | null = null
    setLoading(true)
    setImageURL(null)

    photoStorage.getObjectURL(photo.id).then((url) => {
      if (url) {
        revoke = url
        setImageURL(url)
      } else {
        setImageURL(photo.thumbnail_data_url)
      }
      setLoading(false)
    })

    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [photo.id, photo.thumbnail_data_url])

  const goPrev = useCallback(() => {
    if (hasPrev) onChange(photos[currentIndex - 1])
  }, [hasPrev, photos, currentIndex, onChange])

  const goNext = useCallback(() => {
    if (hasNext) onChange(photos[currentIndex + 1])
  }, [hasNext, photos, currentIndex, onChange])

  // キーボード操作
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, goPrev, goNext])

  const handleDelete = () => {
    if (!onDelete) return
    const confirmed = window.confirm('この写真を削除しますか？\nこの操作は取り消せません。')
    if (confirmed) {
      onDelete(photo.id)
      // 削除後は前後の写真へ or 閉じる
      if (hasNext) onChange(photos[currentIndex + 1])
      else if (hasPrev) onChange(photos[currentIndex - 1])
      else onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* ツールバー */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 shrink-0">
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
              aria-label="削除"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>
        <span className="text-white/70 text-sm">
          {currentIndex + 1} / {photos.length}
        </span>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 写真エリア */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {loading ? (
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
        ) : (
          <img
            src={imageURL ?? photo.thumbnail_data_url}
            alt={photo.original_filename}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        )}

        {/* ← ナビ */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
            aria-label="前の写真"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* → ナビ */}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
            aria-label="次の写真"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* メタ情報フッター */}
      <div className="bg-black/80 px-4 py-3 shrink-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <PhaseBadge phase={photo.phase} size="sm" />
          <span className="text-white/70 text-xs">{photo.original_filename}</span>
        </div>
        {photo.taken_at && (
          <p className="text-white/50 text-xs">{formatDate(photo.taken_at.slice(0, 10))}</p>
        )}
        {photo.comment && (
          <p className="text-white/80 text-sm leading-snug">{photo.comment}</p>
        )}
      </div>
    </div>
  )
}
