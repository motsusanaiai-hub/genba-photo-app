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
}

export function PhotoGrid({ photos, onPhotoClick, onPhotoLongPress, selectedIds, onToggle, onRangeSelect, gridSize = 'large' }: Props) {
  return (
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
        />
      ))}
    </div>
  )
}
