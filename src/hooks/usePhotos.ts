import { useAuthStore } from '@/store/authStore'
import { usePhotoStore } from '@/store/photoStore'
import { photoStorage } from '@/lib/photoStorage'
import { generateThumbnail, generateCompressedImage } from '@/utils/imageUtils'
import type { Photo, Phase } from '@/types/photo'

export function usePhotos(projectId: string) {
  const user = useAuthStore((s) => s.user)
  const { photos, addPhotos, updatePhoto, deletePhoto } = usePhotoStore()

  const projectPhotos = photos
    .filter((p) => p.project_id === projectId)
    .sort((a, b) => a.sort_order - b.sort_order)

  const maxSortOrder = projectPhotos.length
    ? Math.max(...projectPhotos.map((p) => p.sort_order))
    : 0

  // ファイルごとに保存先フェーズを指定してアップロードする
  const uploadPhotosWithPhases = async (
    items: { file: File; phase: Phase | null }[],
    onProgress: (done: number, total: number) => void,
  ) => {
    const newPhotos: Photo[] = []

    for (let i = 0; i < items.length; i++) {
      const { file, phase } = items[i]
      const id = crypto.randomUUID()
      const { dataUrl, width, height } = await generateThumbnail(file)
      await photoStorage.save(id, file)

      // Excel 出力用 600px 圧縮版を生成して保存
      const compressed = await generateCompressedImage(file)
      if (compressed) await photoStorage.saveCompressed(id, compressed)

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
        floor: '',
        location: '',
        sort_order: maxSortOrder + (i + 1) * 1000,
        phase,
        thumbnail_data_url: dataUrl,
        created_at: now,
        updated_at: now,
      })

      onProgress(i + 1, items.length)
    }

    addPhotos(newPhotos)
    return newPhotos
  }

  // 全ファイルを単一フェーズでアップロードする（uploadPhotosWithPhases の単一フェーズ版）
  const uploadPhotos = (
    files: File[],
    phase: Phase | null,
    onProgress: (done: number, total: number) => void,
  ) => uploadPhotosWithPhases(files.map((file) => ({ file, phase })), onProgress)

  // 呼び出し側が隣接判定を行い、2つの写真IDを渡す設計
  // → フィルター中の並び替えでも正しく動く
  const swapPhotoOrder = (idA: string, idB: string) => {
    const a = projectPhotos.find((p) => p.id === idA)
    const b = projectPhotos.find((p) => p.id === idB)
    if (!a || !b) return
    updatePhoto(a.id, { sort_order: b.sort_order })
    updatePhoto(b.id, { sort_order: a.sort_order })
  }

  const removePhoto = async (photoId: string) => {
    await Promise.all([
      photoStorage.remove(photoId),
      photoStorage.removeCompressed(photoId),
    ])
    deletePhoto(photoId)
  }

  const setPhase = (photoId: string, phase: Phase | null) => {
    updatePhoto(photoId, { phase })
  }

  const setComment = (photoId: string, comment: string) => {
    updatePhoto(photoId, { comment })
  }

  const setFloorLocation = (photoId: string, data: { floor: string; location: string }) => {
    updatePhoto(photoId, data)
  }

  return {
    photos: projectPhotos,
    uploadPhotos,
    uploadPhotosWithPhases,
    swapPhotoOrder,
    removePhoto,
    setPhase,
    setComment,
    setFloorLocation,
  }
}
