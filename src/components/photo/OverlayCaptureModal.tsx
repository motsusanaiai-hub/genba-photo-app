import { useEffect, useState } from 'react'
import { BeforePhotoPicker } from './BeforePhotoPicker'
import { OverlayCameraView } from './OverlayCameraView'
import type { Photo } from '@/types/photo'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  beforePhotos: Photo[]
}

export function OverlayCaptureModal({ open, onClose, projectId, beforePhotos }: Props) {
  const [selected, setSelected] = useState<Photo | null>(null)

  // 開くたびに施工前写真の選択からやり直す
  useEffect(() => {
    if (open) setSelected(null)
  }, [open])

  if (!open) return null

  if (!selected) {
    return <BeforePhotoPicker photos={beforePhotos} onSelect={setSelected} onClose={onClose} />
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
