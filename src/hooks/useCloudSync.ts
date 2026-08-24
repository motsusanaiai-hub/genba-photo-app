import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { usePhotoStore } from '@/store/photoStore'
import { useFolderStore } from '@/store/folderStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { photoStorage } from '@/lib/photoStorage'
import {
  fetchCloudProjects,
  fetchCloudPhotos,
  fetchCloudFolders,
  insertCloudProjects,
  insertCloudPhotos,
  insertCloudFolders,
  updateCloudPhoto,
  uploadCompressedToCloud,
} from '@/lib/cloudSync'
import type { Photo } from '@/types/photo'

/**
 * ログイン確定後に1回、Supabaseから工事・写真・未分類フォルダを取得してローカルstateを更新する。
 * ローカルにのみ存在する（クラウド未登録の）工事・写真・フォルダは、このタイミングで
 * クラウドへバックフィル（圧縮写真もStorageへアップロード）し、消えないようにする。
 */
export function useCloudSync() {
  const user = useAuthStore((s) => s.user)
  const setProjects = useProjectStore((s) => s.setProjects)
  const setPhotos = usePhotoStore((s) => s.setPhotos)
  const setFolders = useFolderStore((s) => s.setFolders)
  const syncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return
    if (syncedUserId.current === user.id) return

    let cancelled = false
    ;(async () => {
      const [cloudProjects, cloudPhotos, cloudFolders] = await Promise.all([
        fetchCloudProjects(user.id),
        fetchCloudPhotos(user.id),
        fetchCloudFolders(user.id),
      ])

      const localProjects = useProjectStore.getState().projects
      const localPhotos = usePhotoStore.getState().photos
      const localFolders = useFolderStore.getState().folders

      // クラウドが「過去に一度でも認識したid」の集合。soft delete済み
      // （deleted_atあり）のprojectのidもここに含まれるため、削除済みprojectの
      // 古いローカルコピーが下のlocalOnlyProjects判定に紛れ込まず、
      // 誤って再INSERT（＝復活）されることを防ぐ。
      const cloudProjectIds = new Set(cloudProjects.map((p) => p.id))
      const localOnlyProjects = localProjects.filter(
        (p) => p.user_id === user.id && !cloudProjectIds.has(p.id),
      )

      // 画面・projectStoreへ反映するのは有効（未削除）なprojectのみ。
      // deleted_atが設定されているprojectは、クラウドはidを認識済みだが
      // 可視stateには一切含めない（＝古いローカルコピーが残っていた端末でも、
      // 同期のたびに可視stateから除外される）。
      const activeCloudProjects = cloudProjects.filter((p) => !p.deleted_at)

      // 削除済み現場（deleted_atあり、またはローカルにprojectが存在しない）に
      // 紐づく孤立写真をクラウド同期（バックフィル・INSERT）の対象から除外する。
      // 写真本体・メタデータは端末内に残す仕様のため、そのままだと削除済み
      // project_idを持つ写真が「未同期写真」として拾われ、insertCloudPhotos が
      // photos_project_id_fkey 違反で失敗し続けてしまう。
      //
      // 「有効」の判定は、このデバイスの古いprojectStoreスナップショット
      // （localProjects）ではなく、この同期処理が今まさに確定させる
      // activeCloudProjects（有効な既存project）と localOnlyProjects
      // （新規にバックフィルされ有効になるproject）の集合を使う。
      // こうしないと、他端末で削除されたばかりでこのデバイスにはまだ
      // 「有効」に見えているproject（deleted_atをこの同期で初めて検知する
      // ケース）に対して、その未同期写真を誤って「有効」と判定し、
      // 同じFK違反を再発させてしまう。
      const validLocalProjectIds = new Set([
        ...activeCloudProjects.map((p) => p.id),
        ...localOnlyProjects.map((p) => p.id),
      ])

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

      // フォルダの同期（写真と同様、有効なprojectに紐づく未同期フォルダのみバックフィル対象とする。
      // フォルダにはStorage連携が無いため、写真のような圧縮版アップロード・repair処理は不要）。
      const cloudFolderIds = new Set(cloudFolders.map((f) => f.id))
      const userUnsyncedFolders = localFolders.filter(
        (f) => f.user_id === user.id && !cloudFolderIds.has(f.id),
      )
      const localOnlyFolders = userUnsyncedFolders.filter((f) => validLocalProjectIds.has(f.project_id))
      // 削除済みprojectに紐づく孤立フォルダ：端末内には残すが、クラウド同期対象にはしない
      const orphanedLocalFolders = userUnsyncedFolders.filter(
        (f) => !validLocalProjectIds.has(f.project_id),
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
        insertCloudFolders(localOnlyFolders),
      ])
      if (cancelled) return

      syncedUserId.current = user.id

      const mergedCloudPhotos = cloudPhotos.map((p) =>
        repairedPhotoMap.has(p.id) ? { ...p, storage_path: repairedPhotoMap.get(p.id)! } : p,
      )

      setProjects([
        ...localProjects.filter((p) => p.user_id !== user.id),
        ...activeCloudProjects,
        ...localOnlyProjects,
      ])
      setPhotos([
        ...localPhotos.filter((p) => p.user_id !== user.id),
        ...mergedCloudPhotos,
        ...backfilledPhotos,
        // 孤立写真は同期対象から外すだけで、端末内のstateからは削除しない
        ...orphanedLocalPhotos,
      ])
      setFolders([
        ...localFolders.filter((f) => f.user_id !== user.id),
        ...cloudFolders,
        ...localOnlyFolders,
        // 孤立フォルダは同期対象から外すだけで、端末内のstateからは削除しない
        ...orphanedLocalFolders,
      ])
    })()

    return () => {
      cancelled = true
    }
  }, [user, setProjects, setPhotos, setFolders])
}
