import { X } from 'lucide-react'
import type { Photo } from '@/types/photo'

interface Props {
  photos: Photo[]
  onSelect: (photo: Photo) => void
  onClose: () => void
}

export function BeforePhotoPicker({ photos, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold">施工前写真を選択</h2>
        <button
          onClick={onClose}
          className="rounded-full p-1 hover:bg-muted transition-colors"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <p className="px-4 py-2 text-sm text-muted-foreground shrink-0">
        カメラに重ねて表示する施工前写真をタップしてください
      </p>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 p-1">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => onSelect(photo)}
              className="aspect-square rounded-md overflow-hidden border-2 border-transparent hover:border-primary active:scale-95 transition-all"
            >
              <img
                src={photo.thumbnail_data_url}
                alt={photo.original_filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
