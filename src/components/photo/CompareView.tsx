import { useState } from 'react'
import type { Photo } from '@/types/photo'
import { ALL_PHASE_KEYS, filterByPhaseKey, type PhaseKey } from '@/types/photo'
import { PhotoLightbox } from './PhotoLightbox'
import { ComparePane } from './ComparePane'

interface Props {
  photos: Photo[]
  onCommentChange: (photoId: string, comment: string) => void
  onFloorLocationChange: (photoId: string, data: { floor: string; location: string }) => void
  onReorder: (orderedIds: string[]) => void
  onDeletePhoto?: (photoId: string) => void
}

const LEFT_PHASE_KEY = 'genba-compare-left-phase'
const RIGHT_PHASE_KEY = 'genba-compare-right-phase'

function loadPhase(key: string, fallback: PhaseKey): PhaseKey {
  const raw = localStorage.getItem(key)
  return raw && ALL_PHASE_KEYS.includes(raw as PhaseKey) ? (raw as PhaseKey) : fallback
}

interface LightboxState {
  photo: Photo
  list: Photo[]
}

/**
 * 比較・並び替えモード。左右ペインで独立にフェーズを選び、見比べながら並び替える。
 * PC/タブレット（lg以上）は左右分割、スマホ（lg未満）は上下分割でフル機能を提供する。
 */
export function CompareView({ photos, onCommentChange, onFloorLocationChange, onReorder, onDeletePhoto }: Props) {
  const [leftPhase, setLeftPhase] = useState<PhaseKey>(() => loadPhase(LEFT_PHASE_KEY, 'before'))
  const [rightPhase, setRightPhase] = useState<PhaseKey>(() => loadPhase(RIGHT_PHASE_KEY, 'after'))
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  const handleLeftPhaseChange = (phase: PhaseKey) => {
    setLeftPhase(phase)
    localStorage.setItem(LEFT_PHASE_KEY, phase)
  }

  const handleRightPhaseChange = (phase: PhaseKey) => {
    setRightPhase(phase)
    localStorage.setItem(RIGHT_PHASE_KEY, phase)
  }

  const openLightbox = (phase: PhaseKey) => (photo: Photo) => {
    setLightbox({ photo, list: filterByPhaseKey(photos, phase) })
  }

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">
        <ComparePane
          phase={leftPhase}
          onPhaseChange={handleLeftPhaseChange}
          photos={photos}
          onPhotoClick={openLightbox(leftPhase)}
          onCommentChange={onCommentChange}
          onFloorLocationChange={onFloorLocationChange}
          onReorder={onReorder}
        />
        <ComparePane
          phase={rightPhase}
          onPhaseChange={handleRightPhaseChange}
          photos={photos}
          onPhotoClick={openLightbox(rightPhase)}
          onCommentChange={onCommentChange}
          onFloorLocationChange={onFloorLocationChange}
          onReorder={onReorder}
        />
      </div>

      {lightbox && (
        <PhotoLightbox
          photo={lightbox.photo}
          photos={lightbox.list}
          onClose={() => setLightbox(null)}
          onChange={(photo) => setLightbox((prev) => (prev ? { ...prev, photo } : prev))}
          onDelete={onDeletePhoto}
        />
      )}
    </div>
  )
}
