import { useEffect, useState } from 'react'
import { ReferencePhotoPicker } from './ReferencePhotoPicker'
import { OverlayCameraView } from './OverlayCameraView'
import type { Photo } from '@/types/photo'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  photos: Photo[]
  initialPhoto?: Photo | null
}

export function OverlayCaptureModal({ open, onClose, projectId, photos, initialPhoto }: Props) {
  const [selected, setSelected] = useState<Photo | null>(null)

  // 開くたびに基準写真の選択状態をリセット（長押しから開いた場合はその写真を初期選択）
  useEffect(() => {
    if (open) setSelected(initialPhoto ?? null)
  }, [open, initialPhoto])

  if (!open) return null

  if (!selected) {
    return <ReferencePhotoPicker photos={photos} onSelect={setSelected} onClose={onClose} />
  }

  return (
    <OverlayCameraView
      key={selected.id}
      beforePhoto={selected}
      projectId={projectId}
      onChangeBeforePhoto={() => setSelected(null)}
      onClose={onClose}
    />
  )
}
