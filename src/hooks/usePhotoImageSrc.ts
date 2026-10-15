import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/authStore'
import { getCloudPhotoAccess } from '@/lib/cloudPhotoCache'
import { PhotoImageLoader, type PhotoImageStatus } from '@/lib/photoImageLoader'
import type { Photo } from '@/types/photo'

export type { PhotoImageStatus }

export interface PhotoImageSrc {
  src: string | null
  status: PhotoImageStatus
  /** <img onError> に渡す。署名付きURLの失効などで読み込めなかったときに、URLを1度だけ作り直す */
  onError: () => void
}

type PhotoImageInput = Pick<Photo, 'id' | 'thumbnail_data_url' | 'storage_path'>

/**
 * 一覧・カード・台帳・アクションシート・参照写真ピッカーなどで使う、写真の表示URL。
 * 状態の判断は PhotoImageLoader（端末内の画像を優先 → クラウドは本人の認証で取得した署名付きURL）。
 * 写真・ユーザーが変わると、別の PhotoImageLoader に切り替わる（前の写真・前のユーザーの結果は使わない）。
 */
export function usePhotoImageSrc(photo: PhotoImageInput): PhotoImageSrc {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const local = photo.thumbnail_data_url || null
  const path = photo.storage_path || null

  const loader = useMemo(
    () => new PhotoImageLoader(getCloudPhotoAccess(), { local, path, userId }),
    [local, path, userId],
  )

  useEffect(() => {
    loader.start()
    return loader.dispose
  }, [loader])

  const snapshot = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot)
  return { src: snapshot.src, status: snapshot.status, onError: loader.handleError }
}
