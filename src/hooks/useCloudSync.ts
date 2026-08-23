import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { usePhotoStore } from '@/store/photoStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { photoStorage } from '@/lib/photoStorage'
import {
  fetchCloudProjects,
  fetchCloudPhotos,
  insertCloudProjects,
  insertCloudPhotos,
  updateCloudPhoto,
  uploadCompressedToCloud,
} from '@/lib/cloudSync'
import type { Photo } from '@/types/photo'

/**
 * ログイン確定後に1回、Supabaseから工事・写真を取得してローカルstateを更新する。
 * ローカルにのみ存在する（クラウド未登録の）工事・写真は、このタイミングで
 * クラウドへバックフィル（圧縮写真もStorageへアップロード）し、消えないようにする。
 */
export function useCloudSync() {
  const user = useAuthStore((s) => s.user)
  const setProjects = useProjectStore((s) => s.setProjects)
  const setPhotos = usePhotoStore((s) => s.setPhotos)
  const syncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return
    if (syncedUserId.current === user.id) return

    let cancelled = false
    ;(async () => {
      const [cloudProjects, cloudPhotos] = await Promise.all([
        fetchCloudProjects(user.id),
        fetchCloudPhotos(user.id),
      ])

      const localProjects = useProjectStore.getState().projects
      const localPhotos = usePhotoStore.getState().photos

      const cloudProjectIds = new Set(cloudProjects.map((p) => p.id))
      const localOnlyProjects = localProjects.filter(
        (p) => p.user_id === user.id && !cloudProjectIds.has(p.id),
      )

      // 削除済み現場（ローカルにprojectが存在しない）に紐づく孤立写真を
      // クラウド同期（バックフィル・INSERT）の対象から除外する。
      // 現場削除時はローカルのprojectStoreからもprojectが消える一方、
      // 写真本体・メタデータは端末内に残す仕様のため、そのままだと
      // 削除済みproject_idを持つ写真がここで「未同期写真」として拾われ、
      // insertCloudPhotos が photos_project_id_fkey 違反で失敗し続けてしまう。
      // 現在ローカルに存在するprojectのidだけを「有効」とみなして絞り込む。
      const validLocalProjectIds = new Set(
        localProjects.filter((p) => p.user_id === user.id).map((p) => p.id),
      )

      const cloudPhotoIds = new Set(cloudPhotos.map((p) => p.id))
      const userUnsyncedPhotos = localPhotos.filter(
        (p) => p.user_id === user.id && !cloudPhotoIds.has(p.id),
      )
      // クラウド同期対象：有効なprojectに紐づく未同期写真のみ
      const localOnlyPhotos = userUnsyncedPhotos.filter((p) => validLocalProjectIds.has(p.project_id))
      // 削除済みprojectに紐づく孤立写真：端末内には残すが、クラウド同期対象にはしない
      const orphanedLocalPhotos = userUnsyncedPhotos.filter(
        (p) => !validLocalProjectIds.has(p.project_id),
      )

      // クラウドには既に存在するが storage_path が未設定（アップロード未済）の写真
      const repairTargets = cloudPhotos.filter((p) => !p.storage_path)

      if (cancelled) return

      // 未同期写真の圧縮版をStorageへアップロードしてstorage_pathを確定する
      const backfilledPhotos: Photo[] = []
      for (const photo of localOnlyPhotos) {
        let storagePath = photo.storage_path
        if (!storagePath) {
          const blob = await photoStorage.getCompressedBlob(photo.id)
          if (blob) storagePath = await uploadCompressedToCloud(photo.id, user.id, blob)
        }
        backfilledPhotos.push({ ...photo, storage_path: storagePath ?? null })
      }

      // クラウド側に storage_path が無い既存写真をrepair（IndexedDBの圧縮版をアップロードしてDBを更新）
      const repairedPhotoMap = new Map<string, string>()
      for (const photo of repairTargets) {
        const blob = await photoStorage.getCompressedBlob(photo.id)
        if (!blob) continue
        const storagePath = await uploadCompressedToCloud(photo.id, user.id, blob)
        if (!storagePath) continue
        await updateCloudPhoto(photo.id, { storage_path: storagePath })
        repairedPhotoMap.set(photo.id, storagePath)
      }

      if (cancelled) return

      await Promise.all([
        insertCloudProjects(localOnlyProjects),
        insertCloudPhotos(backfilledPhotos),
      ])
      if (cancelled) return

      syncedUserId.current = user.id

      const mergedCloudPhotos = cloudPhotos.map((p) =>
        repairedPhotoMap.has(p.id) ? { ...p, storage_path: repairedPhotoMap.get(p.id)! } : p,
      )

      setProjects([
        ...localProjects.filter((p) => p.user_id !== user.id),
        ...cloudProjects,
        ...localOnlyProjects,
      ])
      setPhotos([
        ...localPhotos.filter((p) => p.user_id !== user.id),
        ...mergedCloudPhotos,
        ...backfilledPhotos,
        // 孤立写真は同期対象から外すだけで、端末内のstateからは削除しない
        ...orphanedLocalPhotos,
      ])
    })()

    return () => {
      cancelled = true
    }
  }, [user, setProjects, setPhotos])
}
