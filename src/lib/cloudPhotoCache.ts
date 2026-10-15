import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { COMPRESSED_BUCKET } from '@/lib/photoBucket'
import { CloudPhotoAccess, type CloudStorageApi } from '@/lib/cloudPhotoAccess'
import type { Photo } from '@/types/photo'

/**
 * CloudPhotoAccess（クラウド画像の取得）を、実際の Supabase とログイン状態につなぐ。
 * アプリ全体で1つだけ使い、キャッシュは署名付きURLをメモリにだけ持つ。
 *
 * - Supabase は利用者本人のJWTのクライアント（anon キー + ログインセッション）。service_role は使わない。
 * - ログアウト・ユーザー切り替え（ユーザーIDの変化）でキャッシュを全て破棄する。
 *   同じユーザーのままトークンが更新されただけでは破棄しない。
 */

/** 実際の Storage API。Supabase が未設定（開発モード）のときは、常に失敗を返す。 */
export const realStorage: CloudStorageApi = {
  async createSignedUrls(paths, expiresInSec) {
    if (!supabase) return { data: null, error: new Error('supabase is not configured') }
    return supabase.storage.from(COMPRESSED_BUCKET).createSignedUrls(paths, expiresInSec)
  },
  async download(path) {
    if (!supabase) return { data: null, error: new Error('supabase is not configured') }
    return supabase.storage.from(COMPRESSED_BUCKET).download(path)
  },
}

let access: CloudPhotoAccess | null = null

export function getCloudPhotoAccess(): CloudPhotoAccess {
  if (!access) {
    const created = new CloudPhotoAccess({
      storage: realStorage,
      getUserId: () => useAuthStore.getState().user?.id ?? null,
    })
    // ユーザーIDが変わったとき（ログアウト・別ユーザーのログイン）だけ、前のユーザーのURLを破棄する
    useAuthStore.subscribe((state, previous) => {
      if ((state.user?.id ?? null) !== (previous.user?.id ?? null)) created.clear()
    })
    access = created
  }
  return access
}

/** 写真・工事案件の削除のとき、該当する写真のキャッシュを捨てる */
export function evictCloudPhotos(paths: readonly (string | null | undefined)[]) {
  const valid = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (valid.length > 0 && access) access.evict(valid)
}

/**
 * 画面に表示する画像のURLを返す（ライトボックス・撮影オーバーレイなど、非同期に読み込む画面用）。
 * 端末内の画像（base64）があればそれを優先し、なければクラウドから署名付きURLを取得する。
 * 取得できなければ null。
 */
export async function loadPhotoDisplayUrl(photo: Pick<Photo, 'thumbnail_data_url' | 'storage_path'>): Promise<string | null> {
  if (photo.thumbnail_data_url) return photo.thumbnail_data_url
  if (photo.storage_path) return getCloudPhotoAccess().getSignedUrl(photo.storage_path)
  return null
}

/** 署名付きURLの失効などで画像の読み込みに失敗したとき、URLを作り直す（端末内の画像は対象外） */
export async function refreshPhotoDisplayUrl(photo: Pick<Photo, 'thumbnail_data_url' | 'storage_path'>): Promise<string | null> {
  if (photo.thumbnail_data_url || !photo.storage_path) return null
  return getCloudPhotoAccess().getSignedUrl(photo.storage_path, { forceRefresh: true })
}
