import type { Photo } from '@/types/photo'
import { PhotoCard } from './PhotoCard'

interface Props {
  photos: Photo[]
  onPhotoClick: (photo: Photo) => void
  onPhotoLongPress?: (photo: Photo) => void
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
}

export function PhotoGrid({ photos, onPhotoClick, onPhotoLongPress, selectedIds, onToggle }: Props) {
  return (
    <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 p-1">
      {photos.map((photo, index) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          index={index}
          onClick={onPhotoClick}
          onLongPress={onPhotoLongPress}
          isSelected={selectedIds?.has(photo.id) ?? false}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
