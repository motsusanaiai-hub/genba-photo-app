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

/**
 * neighbors（sort_order昇順のPhoto配列）の中で、createdAtが収まるべき位置のsort_orderを返す。
 * 前後の値の中間を返すことで、既存の並び順を崩さずに挿入する。
 * neighborsが空の場合はfallback（通常は写真自身の現在値）をそのまま返す。
 */
function insertSortOrderByCreatedAt(neighbors: Photo[], createdAt: string, fallback: number): number {
  if (neighbors.length === 0) return fallback

  const idx = neighbors.findIndex((p) => p.created_at > createdAt)
  if (idx === -1) return neighbors[neighbors.length - 1].sort_order + 1000
  if (idx === 0) return neighbors[0].sort_order - 1000

  const before = neighbors[idx - 1].sort_order
  const after = neighbors[idx].sort_order
  const mid = Math.floor((before + after) / 2)
  // 隙間が1以下で中間値が取れない場合のフォールバック（極めて稀）
  return mid > before ? mid : after - 1
}

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

  // orderedIds＝フェーズ変更対象（画面上の表示順で渡すこと。タップ順や選択順ではない）。
  //
  // 移動先が施工前/中/後（非null）の場合：
  //   対象フェーズの現在の最後尾（最大sort_order）へ、orderedIdsの順序を保ったまま追加する。
  //   未分類で撮影日時等により散らばっていた並びをそのまま引き継がず、
  //   「その場で選んだ順」＝画面上の並び順で連番を振り直すことで、
  //   工種・部屋単位で分類していく実際の作業手順に沿った並びになる。
  // 移動先が未分類（null）の場合：
  //   sort_orderを単純に「変更しない」と、過去に一度でも分類フェーズへ移動した写真は
  //   その時に採番された「末尾追加用の大きな値」がそのまま残ってしまい、未分類に戻しても
  //   常に末尾に表示されてしまう（sort_orderはフェーズをまたいだ1本の連番のため）。
  //   そこで、created_at（取り込み時に一度だけ設定され、以降のフェーズ変更では
  //   絶対に書き換わらない値）を基準に、現在の未分類写真たちの中で本来収まるべき位置へ
  //   sort_orderを再計算する。これにより「取り込み順・撮影日時に近い位置へ戻る」という
  //   意図した挙動になる（EXIF撮影日時＝taken_atは表示順の基準にしない方針は維持）。
  const setPhaseForPhotos = async (orderedIds: string[], phase: Phase | null) => {
    if (orderedIds.length === 0) return

    if (phase === null) {
      const movingIds = new Set(orderedIds)
      // created_at昇順で処理することで、同一バッチ内の複数写真も互いに正しい相対順になる
      const movingPhotos = orderedIds
        .map((id) => projectPhotos.find((p) => p.id === id))
        .filter((p): p is Photo => !!p)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))

      const neighbors = projectPhotos
        .filter((p) => p.phase === null && !movingIds.has(p.id))
        .sort((a, b) => a.sort_order - b.sort_order)

      const changes = movingPhotos.map((photo) => {
        const sort_order = insertSortOrderByCreatedAt(neighbors, photo.created_at, photo.sort_order)
        // 同じバッチ内の後続写真の挿入位置計算に反映されるよう、確定値を近傍リストへ反映する
        const insertAt = neighbors.findIndex((p) => p.sort_order > sort_order)
        const inserted = { ...photo, sort_order }
        if (insertAt === -1) neighbors.push(inserted)
        else neighbors.splice(insertAt, 0, inserted)
        return { id: photo.id, sort_order }
      })

      changes.forEach(({ id, sort_order }) => updatePhoto(id, { phase, sort_order }))
      await Promise.all(changes.map(({ id, sort_order }) => updateCloudPhoto(id, { phase, sort_order })))
      return
    }

    const movingIds = new Set(orderedIds)
    const targetPhasePhotos = projectPhotos.filter((p) => p.phase === phase && !movingIds.has(p.id))
    const targetMaxSortOrder = targetPhasePhotos.length
      ? Math.max(...targetPhasePhotos.map((p) => p.sort_order))
      : 0

    const changes = orderedIds.map((id, i) => ({
      id,
      sort_order: targetMaxSortOrder + (i + 1) * 1000,
    }))

    changes.forEach(({ id, sort_order }) => updatePhoto(id, { phase, sort_order }))
    await Promise.all(changes.map(({ id, sort_order }) => updateCloudPhoto(id, { phase, sort_order })))
  }

  // 1枚だけフェーズ変更する場合の薄いラッパー（アクションシート等、単一写真向け）
  const setPhase = (photoId: string, phase: Phase | null) => setPhaseForPhotos([photoId], phase)

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
    setPhaseForPhotos,
    setComment,
    setFloorLocation,
  }
}
