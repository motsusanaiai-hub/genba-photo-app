import { useState } from 'react'
import { X } from 'lucide-react'
import { PhaseBadge } from './PhaseBadge'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'
import { cn } from '@/lib/utils'

type TabFilter = 'all' | Phase | 'unclassified'

const TABS: { value: TabFilter; label: string }[] = [
  { value: 'all',          label: '全て' },
  { value: 'before',       label: PHASE_CONFIG.before.label },
  { value: 'during',       label: PHASE_CONFIG.during.label },
  { value: 'after',        label: PHASE_CONFIG.after.label },
  { value: 'unclassified', label: '未分類' },
]

interface Props {
  photos: Photo[]
  onSelect: (photo: Photo) => void
  onClose: () => void
}

/** 半透明撮影の基準写真を選ぶ画面。フェーズに関係なく全写真から選択できる */
export function ReferencePhotoPicker({ photos, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<TabFilter>('all')

  const filtered = photos.filter((photo) => {
    if (tab === 'all') return true
    if (tab === 'unclassified') return photo.phase == null
    return photo.phase === tab
  })

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold">基準写真を選択</h2>
        <button
          onClick={onClose}
          className="rounded-full p-1 hover:bg-muted transition-colors"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <p className="px-4 py-2 text-sm text-muted-foreground shrink-0">
        カメラに重ねて表示する写真をタップしてください
      </p>

      {/* フェーズタブ */}
      <div className="flex overflow-x-auto border-b shrink-0 px-1">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              'px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors shrink-0',
              tab === value
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-center p-4">
            <p className="text-sm text-muted-foreground">写真がまだありません</p>
            <p className="text-xs text-muted-foreground">まずは📷で1枚撮影してください</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center p-4">
            <p className="text-sm text-muted-foreground">この区分の写真はまだありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 p-1">
            {filtered.map((photo) => (
              <button
                key={photo.id}
                onClick={() => onSelect(photo)}
                className="aspect-square rounded-md overflow-hidden border-2 border-transparent hover:border-primary active:scale-95 transition-all relative"
              >
                <img
                  src={photo.thumbnail_data_url}
                  alt={photo.original_filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {photo.phase && (
                  <div className="absolute top-1 right-1">
                    <PhaseBadge phase={photo.phase} size="sm" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
