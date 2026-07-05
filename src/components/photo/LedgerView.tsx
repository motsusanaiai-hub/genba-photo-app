import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Photo } from '@/types/photo'
import { sortPhotoIds, type SortMode } from '@/utils/photoSort'
import { LedgerRow } from './LedgerRow'
import { SortMenu } from './SortMenu'

interface Props {
  photos: Photo[]
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
  onFloorLocationChange: (photoId: string, data: { floor: string; location: string }) => void
  onReorder?: (orderedIds: string[]) => void  // optional: なければ▲▼・ドラッグハンドル・並び替えメニュー非表示
}

export function LedgerView({ photos, onPhotoClick, onCommentChange, onFloorLocationChange, onReorder }: Props) {
  const commented = photos.filter((p) => p.comment.trim()).length
  const allDone = photos.length > 0 && commented === photos.length

  // サムネイル自体もドラッグハンドルを兼ねる（クリックでライトボックスも開ける）ため、
  // マウスとタッチで別センサーを使い分けて誤操作を防ぐ。
  // - マウス: 8px動いたらドラッグ開始（クリックとの判定はブラウザのclick挙動に準拠）
  // - タッチ: 200ms長押し + 8px許容範囲。単純なタップ（スクロール・ライトボックス表示）を
  //   ドラッグと誤認しないよう、即座には反応させない
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!onReorder || !over || active.id === over.id) return
    const oldIndex = photos.findIndex((p) => p.id === active.id)
    const newIndex = photos.findIndex((p) => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(photos, oldIndex, newIndex).map((p) => p.id))
  }

  const handleSort = (mode: SortMode) => {
    onReorder?.(sortPhotoIds(photos, mode))
  }

  return (
    <div>
      {/* 入力状況バー + 並び替えメニュー */}
      <div className="px-4 py-2 bg-muted/40 border-b flex items-center gap-2 text-xs text-muted-foreground select-none">
        <span>全 {photos.length} 枚</span>
        <span>·</span>
        <span>
          コメント入力済み:{' '}
          <span className={allDone ? 'text-green-600 font-medium' : ''}>{commented}</span>{' '}
          / {photos.length} 枚
        </span>
        {allDone && <span className="text-green-600 font-medium">· 全て完了</span>}
        {onReorder && (
          <div className="ml-auto">
            <SortMenu onSort={handleSort} />
          </div>
        )}
      </div>

      {/* 台帳行リスト */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div>
            {photos.map((photo, index) => (
              <LedgerRow
                key={photo.id}
                photo={photo}
                index={index}
                onPhotoClick={onPhotoClick}
                onCommentChange={onCommentChange}
                onFloorLocationChange={onFloorLocationChange}
                prevComment={index > 0 ? photos[index - 1].comment : undefined}
                dragHandle={!!onReorder}
                onMoveUp={
                  onReorder && index > 0
                    ? () => onReorder(arrayMove(photos, index, index - 1).map((p) => p.id))
                    : undefined
                }
                onMoveDown={
                  onReorder && index < photos.length - 1
                    ? () => onReorder(arrayMove(photos, index, index + 1).map((p) => p.id))
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
