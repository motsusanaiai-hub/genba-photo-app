import { useAuthStore } from '@/store/authStore'
import { usePhotoStore } from '@/store/photoStore'
import { photoStorage } from '@/lib/photoStorage'
import { generateThumbnail } from '@/utils/imageUtils'
import type { Photo, Phase } from '@/types/photo'

export function usePhotos(projectId: string) {
  const user = useAuthStore((s) => s.user)
  const { photos, addPhotos, updatePhoto, deletePhoto } = usePhotoStore()

  const projectPhotos = photos
    .filter((p) => p.project_id === projectId)
    .sort((a, b) => a.sort_order - b.sort_order)

  const filtered = (phase: Phase | 'all'): Photo[] =>
    phase === 'all' ? projectPhotos : projectPhotos.filter((p) => p.phase === phase)

  const maxSortOrder = projectPhotos.length
    ? Math.max(...projectPhotos.map((p) => p.sort_order))
    : 0

  const uploadPhotos = async (
    files: File[],
    phase: Phase | null,
    onProgress: (done: number, total: number) => void,
  ) => {
    const newPhotos: Photo[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const id = crypto.randomUUID()
      const { dataUrl, width, height } = await generateThumbnail(file)
      await photoStorage.save(id, file)

      const now = new Date().toISOString()
      newPhotos.push({
        id,
        project_id: projectId,
        user_id: user?.id ?? '',
        original_filename: file.name,
        file_size: file.size,
        width,
        height,
        taken_at: new Date(file.lastModified).toISOString(),
        comment: '',
        sort_order: maxSortOrder + (i + 1) * 1000,
        phase,
        thumbnail_data_url: dataUrl,
        created_at: now,
        updated_at: now,
      })

      onProgress(i + 1, files.length)
    }

    addPhotos(newPhotos)
  }

  const movePhoto = (photoId: string, direction: 'up' | 'down') => {
    const idx = projectPhotos.findIndex((p) => p.id === photoId)
    if (direction === 'up' && idx <= 0) return
    if (direction === 'down' && idx >= projectPhotos.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const curr = projectPhotos[idx]
    const swap = projectPhotos[swapIdx]
    updatePhoto(curr.id, { sort_order: swap.sort_order })
    updatePhoto(swap.id, { sort_order: curr.sort_order })
  }

  const removePhoto = async (photoId: string) => {
    await photoStorage.remove(photoId)
    deletePhoto(photoId)
  }

  const setPhase = (photoId: string, phase: Phase | null) => {
    updatePhoto(photoId, { phase })
  }

  const setComment = (photoId: string, comment: string) => {
    updatePhoto(photoId, { comment })
  }

  return {
    photos: projectPhotos,
    filtered,
    uploadPhotos,
    movePhoto,
    removePhoto,
    setPhase,
    setComment,
  }
}
