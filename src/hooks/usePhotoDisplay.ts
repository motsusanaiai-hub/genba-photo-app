import { useCallback, useEffect, useRef, useState } from 'react'
import { photoStorage } from '@/lib/photoStorage'
import { isCurrentUsersPhoto } from '@/lib/exportGuard'
import { loadPhotoDisplayUrl, refreshPhotoDisplayUrl } from '@/lib/cloudPhotoCache'
import { PhotoDisplayController, type PhotoDisplayDeps, type PhotoDisplayState } from '@/lib/photoDisplayController'
import type { Photo } from '@/types/photo'

const defaultDeps: PhotoDisplayDeps = {
  getLocalObjectUrl: (id) => photoStorage.getObjectURL(id),
  getLocalCompressedUrl: async (id) => {
    const blob = await photoStorage.getCompressedBlob(id)
    return blob ? URL.createObjectURL(blob) : null
  },
  loadDisplayUrl: loadPhotoDisplayUrl,
  refreshDisplayUrl: refreshPhotoDisplayUrl,
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  canAccess: isCurrentUsersPhoto,
}

const INITIAL: PhotoDisplayState = { url: null, loading: true, localOriginal: false }

/**
 * 大きく表示する1枚の写真のURL（ライトボックス・撮影オーバーレイ用）。
 * 写真が切り替わる・画面が閉じられると、それまでの取得（失敗後の再取得を含む）の結果は反映しない。
 */
export function usePhotoDisplay(photo: Photo): { state: PhotoDisplayState; handleError: () => void } {
  // どの写真の状態かを一緒に持つ。写真が切り替わった直後の描画で、前の写真のURLを出さないため
  const [held, setHeld] = useState<{ photoId: string; state: PhotoDisplayState }>({ photoId: photo.id, state: INITIAL })
  const controllerRef = useRef<PhotoDisplayController | null>(null)

  useEffect(() => {
    const photoId = photo.id
    const controller = new PhotoDisplayController(photo, defaultDeps, (next) => setHeld({ photoId, state: next }))
    controllerRef.current = controller
    void controller.load()
    return () => {
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, photo.thumbnail_data_url, photo.storage_path])

  const handleError = useCallback(() => {
    void controllerRef.current?.handleError()
  }, [])

  return { state: held.photoId === photo.id ? held.state : INITIAL, handleError }
}
