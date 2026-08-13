import { useAuthStore } from '@/store/authStore'
import { usePhotoStore } from '@/store/photoStore'
import { photoStorage } from '@/lib/photoStorage'
import { generateThumbnail, generateCompressedImage, resolveTakenAt } from '@/utils/imageUtils'
import {
  insertCloudPhotos,
  updateCloudPhoto,
  deleteCloudPhoto,
  uploadCompressedToCloud,
  removeCompressedFromCloud,
} from '@/lib/cloudSync'
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
      const { dataUrl, width, height, failed } = await generateThumbnail(file)
      const takenAt = await resolveTakenAt(file)
      await photoStorage.save(id, file)

      // Excel 出力用 600px 圧縮版を生成して保存
      const compressed = await generateCompressedImage(file)
      let storagePath: string | null = null
      if (compressed) {
        await photoStorage.saveCompressed(id, compressed)
        storagePath = await uploadCompressedToCloud(id, user?.id ?? '', compressed)
      }

      const now = new Date().toISOString()
      newPhotos.push({
        id,
        project_id: projectId,
        user_id: user?.id ?? '',
        original_filename: file.name,
        file_size: file.size,
        width,
        height,
        taken_at: takenAt,
        comment: '',
        floor: '',
        location: '',
        sort_order: maxSortOrder + (i + 1) * 1000,
        phase,
        thumbnail_data_url: dataUrl,
        storage_path: storagePath,
        created_at: now,
        updated_at: now,
        format_warning: failed,
      })

      onProgress(i + 1, items.length)
    }

    addPhotos(newPhotos)
    await insertCloudPhotos(newPhotos)
    return newPhotos
  }

  // 全ファイルを単一フェーズでアップロードする（uploadPhotosWithPhases の単一フェーズ版）
  const uploadPhotos = (
    files: File[],
    phase: Phase | null,
    onProgress: (done: number, total: number) => void,
  ) => uploadPhotosWithPhases(files.map((file) => ({ file, phase })), onProgress)

  // orderedIds＝並び替え対象（表示中の一覧など、任意の部分集合）の新しい並び順。
  // 対象写真が現在持っている sort_order 値の集合を「枠」として温存し、その枠内だけを
  // 並び替える（対象外の写真・全体の並び順への影響を最小限にするため）。
  // ▲▼ボタン・ドラッグ＆ドロップ・並び替えメニューは全てこの1関数を経由する。
  const reorderPhotos = async (orderedIds: string[]) => {
    const byId = new Map(projectPhotos.map((p) => [p.id, p]))
    const validIds = orderedIds.filter((id) => byId.has(id))
    if (validIds.length < 2) return

    const slots = validIds.map((id) => byId.get(id)!.sort_order).sort((a, b) => a - b)

    const changes = validIds
      .map((id, i) => ({ id, sort_order: slots[i] }))
      .filter(({ id, sort_order }) => byId.get(id)!.sort_order !== sort_order)

    changes.forEach(({ id, sort_order }) => updatePhoto(id, { sort_order }))
    await Promise.all(changes.map(({ id, sort_order }) => updateCloudPhoto(id, { sort_order })))
  }

  const removePhoto = async (photoId: string) => {
    const photo = photos.find((p) => p.id === photoId)

    await Promise.all([
      photoStorage.remove(photoId),
      photoStorage.removeCompressed(photoId),
    ])
    deletePhoto(photoId)
    await Promise.all([
      photo?.storage_path ? removeCompressedFromCloud(photo.storage_path) : Promise.resolve(),
      deleteCloudPhoto(photoId),
    ])
  }

  const setPhase = async (photoId: string, phase: Phase | null) => {
    updatePhoto(photoId, { phase })
    await updateCloudPhoto(photoId, { phase })
  }

  const setComment = async (photoId: string, comment: string) => {
    updatePhoto(photoId, { comment })
    await updateCloudPhoto(photoId, { comment })
  }

  const setFloorLocation = async (photoId: string, data: { floor: string; location: string }) => {
    updatePhoto(photoId, data)
    await updateCloudPhoto(photoId, data)
  }

  return {
    photos: projectPhotos,
    uploadPhotos,
    uploadPhotosWithPhases,
    reorderPhotos,
    removePhoto,
    setPhase,
    setComment,
    setFloorLocation,
  }
}
