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
    console.log('[sync] start')
    console.log('[sync] user', user?.id)
    console.log('[sync] configured', isSupabaseConfigured)
    console.log('[sync] syncedUserId.current', syncedUserId.current)

    if (!user || !isSupabaseConfigured) {
      console.log('[sync] abort: no user or not configured')
      return
    }
    if (syncedUserId.current === user.id) {
      console.log('[sync] abort: already synced for', user.id)
      return
    }

    let cancelled = false
    ;(async () => {
      console.log('[sync] before fetchCloudProjects')
      const [cloudProjects, cloudPhotos] = await Promise.all([
        fetchCloudProjects(user.id),
        fetchCloudPhotos(user.id),
      ])
      console.log('[sync] after fetchCloudProjects', {
        cloudProjects: cloudProjects.length,
        cloudPhotos: cloudPhotos.length,
        cancelled,
      })

      const localProjects = useProjectStore.getState().projects
      const localPhotos = usePhotoStore.getState().photos

      const cloudProjectIds = new Set(cloudProjects.map((p) => p.id))
      const localOnlyProjects = localProjects.filter(
        (p) => p.user_id === user.id && !cloudProjectIds.has(p.id),
      )

      const cloudPhotoIds = new Set(cloudPhotos.map((p) => p.id))
      const localOnlyPhotos = localPhotos.filter(
        (p) => p.user_id === user.id && !cloudPhotoIds.has(p.id),
      )

      // クラウドには既に存在するが storage_path が未設定（アップロード未済）の写真
      const repairTargets = cloudPhotos.filter((p) => !p.storage_path)

      console.log('[sync] backfill candidates', {
        localProjects: localProjects.length,
        localPhotos: localPhotos.length,
        localOnlyProjects: localOnlyProjects.length,
        localOnlyPhotos: localOnlyPhotos.length,
        uploadTargets: localOnlyPhotos.filter((p) => !p.storage_path).length,
        repairTargets: repairTargets.length,
      })

      if (cancelled) {
        console.log('[sync] cancelled before backfill, skip insert/upload/merge')
        return
      }

      // 未同期写真の圧縮版をStorageへアップロードしてstorage_pathを確定する
      const backfilledPhotos: Photo[] = []
      for (const photo of localOnlyPhotos) {
        let storagePath = photo.storage_path
        if (!storagePath) {
          const blob = await photoStorage.getCompressedBlob(photo.id)
          console.log('[sync] uploadCompressedToCloud target', photo.id, 'hasBlob:', !!blob)
          if (blob) storagePath = await uploadCompressedToCloud(photo.id, user.id, blob)
        }
        backfilledPhotos.push({ ...photo, storage_path: storagePath ?? null })
      }

      // クラウド側に storage_path が無い既存写真をrepair（IndexedDBの圧縮版をアップロードしてDBを更新）
      const repairedPhotoMap = new Map<string, string>()
      for (const photo of repairTargets) {
        const blob = await photoStorage.getCompressedBlob(photo.id)
        console.log('[sync] repair target', photo.id, 'hasBlob:', !!blob)
        if (!blob) continue
        const storagePath = await uploadCompressedToCloud(photo.id, user.id, blob)
        if (!storagePath) continue
        await updateCloudPhoto(photo.id, { storage_path: storagePath })
        repairedPhotoMap.set(photo.id, storagePath)
      }
      console.log('[sync] repair done', { repaired: repairedPhotoMap.size })

      if (cancelled) return

      console.log('[sync] insertCloudProjects/insertCloudPhotos', {
        projects: localOnlyProjects.length,
        photos: backfilledPhotos.length,
      })
      await Promise.all([
        insertCloudProjects(localOnlyProjects),
        insertCloudPhotos(backfilledPhotos),
      ])
      if (cancelled) {
        console.log('[sync] cancelled before merge (after backfill), skip setProjects/setPhotos')
        return
      }

      syncedUserId.current = user.id

      const mergedCloudPhotos = cloudPhotos.map((p) =>
        repairedPhotoMap.has(p.id) ? { ...p, storage_path: repairedPhotoMap.get(p.id)! } : p,
      )

      console.log('[sync] setProjects/setPhotos', {
        projects: cloudProjects.length + localOnlyProjects.length,
        photos: mergedCloudPhotos.length + backfilledPhotos.length,
      })
      setProjects([
        ...localProjects.filter((p) => p.user_id !== user.id),
        ...cloudProjects,
        ...localOnlyProjects,
      ])
      setPhotos([
        ...localPhotos.filter((p) => p.user_id !== user.id),
        ...mergedCloudPhotos,
        ...backfilledPhotos,
      ])
    })()

    return () => {
      console.log('[sync] cleanup (cancelled = true)')
      cancelled = true
    }
  }, [user, setProjects, setPhotos])
}
