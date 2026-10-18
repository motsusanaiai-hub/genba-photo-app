import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { getCloudPhotoAccess } from '@/lib/cloudPhotoCache'
import { isOwnedPhoto, resolveOwnerId } from '@/lib/ownership'
import { photoStorage } from '@/lib/photoStorage'
import { PhotoImageLoader, type PhotoImageStatus } from '@/lib/photoImageLoader'
import type { Photo } from '@/types/photo'

export type { PhotoImageStatus }

export interface PhotoImageSrc {
  src: string | null
  status: PhotoImageStatus
  /** <img onError> に渡す。署名付きURLの失効などで読み込めなかったときに、URLを1度だけ作り直す */
  onError: () => void
}

type PhotoImageInput = Pick<Photo, 'id' | 'user_id' | 'project_id' | 'thumbnail_data_url' | 'storage_path'>

/** 端末内の600px圧縮画像（IndexedDB）から Blob URL を作る。無ければ null */
async function readCompressedUrl(photoId: string): Promise<string | null> {
  const blob = await photoStorage.getCompressedBlob(photoId)
  return blob ? URL.createObjectURL(blob) : null
}

/**
 * 一覧・カード・台帳・アクションシート・参照写真ピッカーなどで使う、写真の表示URL。
 * 状態の判断は PhotoImageLoader（端末内のサムネイル → 端末内の600px圧縮画像 → クラウドの署名付きURL）。
 * 端末内の画像（IndexedDB）にもクラウドにも、本人の工事案件の本人の写真でなければ取りに行かない（H-1）。
 * 写真・ユーザーが変わると、別の PhotoImageLoader に切り替わる（前の写真・前のユーザーの結果は使わない）。
 */
export function usePhotoImageSrc(photo: PhotoImageInput): PhotoImageSrc {
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const ownerId = resolveOwnerId({ user, initialized })
  const owned = useProjectStore((s) => isOwnedPhoto(photo, s.projects, ownerId))
  const userId = owned ? ownerId : null
  const local = owned ? photo.thumbnail_data_url || null : null
  const path = owned ? photo.storage_path || null : null
  const photoId = photo.id

  const loader = useMemo(
    () =>
      new PhotoImageLoader(
        getCloudPhotoAccess(),
        { local, path, userId, canReadLocal: owned },
        { readCompressedUrl: () => readCompressedUrl(photoId) },
      ),
    [local, path, userId, owned, photoId],
  )

  useEffect(() => {
    loader.start()
    return loader.dispose
  }, [loader])

  const snapshot = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot)
  return { src: snapshot.src, status: snapshot.status, onError: loader.handleError }
}
