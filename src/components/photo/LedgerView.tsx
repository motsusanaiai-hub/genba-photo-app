import type { Photo } from '@/types/photo'
import { LedgerRow } from './LedgerRow'

interface Props {
  photos: Photo[]
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
}

export function LedgerView({ photos, onPhotoClick, onCommentChange }: Props) {
  const commented = photos.filter((p) => p.comment.trim()).length
  const allDone = photos.length > 0 && commented === photos.length

  return (
    <div>
      {/* 入力状況バー */}
      <div className="px-4 py-2 bg-muted/40 border-b flex items-center gap-2 text-xs text-muted-foreground select-none">
        <span>全 {photos.length} 枚</span>
        <span>·</span>
        <span>
          コメント入力済み: <span className={allDone ? 'text-green-600 font-medium' : ''}>{commented}</span> / {photos.length} 枚
        </span>
        {allDone && (
          <span className="text-green-600 font-medium">· 全て完了</span>
        )}
      </div>

      {/* 台帳行リスト */}
      <div>
        {photos.map((photo, index) => (
          <LedgerRow
            key={photo.id}
            photo={photo}
            index={index}
            onPhotoClick={onPhotoClick}
            onCommentChange={onCommentChange}
          />
        ))}
      </div>
    </div>
  )
}
