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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import type { Photo } from '@/types/photo'
import { PhotoCard } from './PhotoCard'
import { cn } from '@/lib/utils'

export type GridSize = 'large' | 'medium' | 'small'

const GRID_SIZE_CLASSES: Record<GridSize, string> = {
  large: 'grid-cols-3 lg:grid-cols-4',
  medium: 'grid-cols-3 lg:grid-cols-6',
  small: 'grid-cols-3 lg:grid-cols-9',
}

interface Props {
  photos: Photo[]
  onPhotoClick: (photo: Photo) => void
  onPhotoLongPress?: (photo: Photo) => void
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
  onRangeSelect?: (id: string) => void
  gridSize?: GridSize
  onReorder?: (orderedIds: string[]) => void  // optional: なければドラッグハンドル非表示・並び替え不可
}

export function PhotoGrid({
  photos,
  onPhotoClick,
  onPhotoLongPress,
  selectedIds,
  onToggle,
  onRangeSelect,
  gridSize = 'large',
  onReorder,
}: Props) {
  // ドラッグはカード隅の専用ハンドルからしか開始しない（listeners をハンドルにしか渡さないため）。
  // センサー設定自体は台帳表示（LedgerView）と揃え、誤操作防止の挙動を全画面で統一する。
  // - マウス: 8px動いたらドラッグ開始
  // - タッチ: 200ms長押し + 8px許容範囲（スクロールとの誤操作防止）
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

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div className={cn('grid gap-1 p-1', GRID_SIZE_CLASSES[gridSize])}>
          {photos.map((photo, index) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={index}
              onClick={onPhotoClick}
              onLongPress={onPhotoLongPress}
              isSelected={selectedIds?.has(photo.id) ?? false}
              onToggle={onToggle}
              onRangeSelect={onRangeSelect}
              dragHandle={!!onReorder}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
