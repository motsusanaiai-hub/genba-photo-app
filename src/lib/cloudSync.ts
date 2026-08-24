import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Project } from '@/types/project'
import type { Photo, PhotoFolder } from '@/types/photo'

const COMPRESSED_BUCKET = 'photo-compressed'

// ─── Storage URL ────────────────────────────────────────────

/** 公開バケット上の600px圧縮写真のURLを取得する（同期・即時利用可） */
export function getCloudPhotoUrl(storagePath: string): string | null {
  if (!supabase) return null
  return supabase.storage.from(COMPRESSED_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

/**
 * 一覧・台帳・ライトボックス等で表示するサムネイルURLを解決する。
 * 1st: ローカル端末で生成した base64（即時表示） / 2nd: Supabase Storage の公開URL（他端末分）
 */
export function resolvePhotoThumbUrl(photo: Photo): string {
  if (photo.thumbnail_data_url) return photo.thumbnail_data_url
  if (photo.storage_path) return getCloudPhotoUrl(photo.storage_path) ?? ''
  return ''
}

// ─── projects ───────────────────────────────────────────────

function projectRow(project: Project) {
  return {
    id: project.id,
    user_id: project.user_id,
    name: project.name,
    location: project.location,
    start_date: project.start_date,
    end_date: project.end_date,
    status: project.status,
    cover_photo_id: project.cover_photo_id,
    created_at: project.created_at,
    updated_at: project.updated_at,
    // 既存ローカルデータにキー自体が無い場合(undefined)も null（未削除）として送る
    deleted_at: project.deleted_at ?? null,
  }
}

export async function fetchCloudProjects(userId: string): Promise<Project[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await supabase.from('projects').select('*').eq('user_id', userId)
  if (error) {
    console.error('[cloudSync] fetchCloudProjects failed:', error)
    return []
  }
  return (data ?? []) as Project[]
}

export async function insertCloudProjects(projects: Project[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || projects.length === 0) return
  const { error } = await supabase.from('projects').insert(projects.map(projectRow))
  if (error) console.error('[cloudSync] insertCloudProjects failed:', error)
}

export async function updateCloudProject(id: string, data: Partial<Project>): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase
    .from('projects')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[cloudSync] updateCloudProject failed:', error)
}

export interface DeleteProjectCascadeResult {
  /** 対象プロジェクトの写真に紐づくStorage画像を全て削除できたか（対象0件の場合も true） */
  storageDeleted: boolean
  /** 削除に失敗したStorageパス（空なら全件成功、または対象なし） */
  storageFailedPaths: string[]
  /** photosレコードの削除に成功したか */
  photosDeleted: boolean
  /** projectsレコードのsoft delete（deleted_at設定）に成功したか */
  projectDeleted: boolean
}

/**
 * 現場削除時、Supabase側（projects / photos / Storage画像）をまとめて削除する。
 * 対象は project_id で厳密に絞り込むため、他の現場のデータには影響しない。
 * ※ 端末内のIndexedDB / localStorage（写真本体・メタデータ）はここでは一切削除しない
 *   （現場削除後も端末内に写真データが残る仕様のため、呼び出し側でも触らないこと）。
 *
 * projects自体は物理DELETEしない。deleted_atを設定するsoft deleteとし、
 * 「削除済みである」という事実をクラウド側に残す（別端末・別ブラウザに残っていた
 * 削除前の古いローカルコピーが、useCloudSyncによって誤って復活しないようにするため）。
 * photos / Storageは従来通り物理削除する。
 *
 * 途中で失敗しても後続の削除は止めず（例: Storage削除が一部失敗しても photos/projects の
 * 処理は続行する）、どの段階が失敗したかを戻り値で報告する。呼び出し側はこれを見て
 * ログ・再試行導線を検討できる。
 */
export async function deleteCloudProjectCascade(projectId: string): Promise<DeleteProjectCascadeResult> {
  const result: DeleteProjectCascadeResult = {
    storageDeleted: true,
    storageFailedPaths: [],
    photosDeleted: false,
    projectDeleted: false,
  }
  if (!isSupabaseConfigured || !supabase) return result

  // 1. 対象現場の写真一覧（storage_path含む）を project_id で限定して取得。
  //    他の現場のstorage_pathを誤って混入させないよう、ここで得たパスのみを削除対象にする。
  const { data: photoRows, error: fetchError } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('project_id', projectId)

  if (fetchError) {
    console.error('[cloudSync] deleteCloudProjectCascade: fetch photos failed:', projectId, fetchError)
  }

  const storagePaths = (photoRows ?? [])
    .map((p) => p.storage_path as string | null)
    .filter((p): p is string => !!p)

  // 2. Storage上の圧縮画像を削除（100件ずつバッチ）
  if (storagePaths.length > 0) {
    const CHUNK_SIZE = 100
    for (let i = 0; i < storagePaths.length; i += CHUNK_SIZE) {
      const chunk = storagePaths.slice(i, i + CHUNK_SIZE)
      const { error } = await supabase.storage.from(COMPRESSED_BUCKET).remove(chunk)
      if (error) {
        result.storageDeleted = false
        result.storageFailedPaths.push(...chunk)
        console.error('[cloudSync] deleteCloudProjectCascade: storage remove failed:', projectId, chunk, error)
      }
    }
  }

  // 3. photosレコード削除（project_idで限定。projectsのON DELETE CASCADEに任せず明示的に実行）
  const { error: photosError } = await supabase.from('photos').delete().eq('project_id', projectId)
  if (photosError) {
    console.error('[cloudSync] deleteCloudProjectCascade: delete photos failed:', projectId, photosError)
  } else {
    result.photosDeleted = true
  }

  // 4. projectsはsoft delete（deleted_atを設定）。物理DELETEはしない
  //    （authenticated/anonにはDELETE権限自体が無く、実行しても失敗する）。
  const nowIso = new Date().toISOString()
  const { error: projectError } = await supabase
    .from('projects')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', projectId)
  if (projectError) {
    console.error('[cloudSync] deleteCloudProjectCascade: soft-delete project failed:', projectId, projectError)
  } else {
    result.projectDeleted = true
  }

  return result
}

// ─── photos ─────────────────────────────────────────────────

function photoRow(photo: Photo) {
  return {
    id: photo.id,
    project_id: photo.project_id,
    user_id: photo.user_id,
    original_filename: photo.original_filename,
    file_size: photo.file_size,
    width: photo.width,
    height: photo.height,
    taken_at: photo.taken_at,
    comment: photo.comment,
    floor: photo.floor ?? '',
    location: photo.location ?? '',
    sort_order: photo.sort_order,
    phase: photo.phase,
    // folder_id/previous_folder_idがnull/undefinedの場合はキー自体を送らない。
    // 新規アップロード写真は常にどちらもnullで作られるため、photo_folders
    // マイグレーション未適用のSupabase環境でも「写真アップロード → クラウド保存」
    // という基幹フローが存在しない列を参照して失敗することがないようにするための防御。
    ...(photo.folder_id != null ? { folder_id: photo.folder_id } : {}),
    ...(photo.previous_folder_id != null ? { previous_folder_id: photo.previous_folder_id } : {}),
    storage_path: photo.storage_path,
    created_at: photo.created_at,
    updated_at: photo.updated_at,
  }
}

export async function fetchCloudPhotos(userId: string): Promise<Photo[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await supabase.from('photos').select('*').eq('user_id', userId)
  if (error) {
    console.error('[cloudSync] fetchCloudPhotos failed:', error)
    return []
  }
  // thumbnail_data_url はDBに無いため空文字で補完（表示は resolvePhotoThumbUrl が Storage URL にフォールバック）
  return (data ?? []).map((row) => ({ ...row, thumbnail_data_url: '' })) as Photo[]
}

export async function insertCloudPhotos(photos: Photo[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || photos.length === 0) return
  const { error } = await supabase.from('photos').insert(photos.map(photoRow))
  if (error) console.error('[cloudSync] insertCloudPhotos failed:', error)
}

export async function updateCloudPhoto(id: string, data: Partial<Omit<Photo, 'thumbnail_data_url'>>): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase
    .from('photos')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[cloudSync] updateCloudPhoto failed:', error)
}

export async function deleteCloudPhoto(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase.from('photos').delete().eq('id', id)
  if (error) console.error('[cloudSync] deleteCloudPhoto failed:', error)
}

// ─── Storage（600px圧縮写真） ───────────────────────────────

export async function uploadCompressedToCloud(photoId: string, userId: string, blob: Blob): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const path = `${userId}/${photoId}.jpg`

  const { error } = await supabase.storage.from(COMPRESSED_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) {
    console.error('[cloudSync] uploadCompressedToCloud failed:', error)
    return null
  }
  return path
}

export async function removeCompressedFromCloud(storagePath: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase.storage.from(COMPRESSED_BUCKET).remove([storagePath])
  if (error) console.error('[cloudSync] removeCompressedFromCloud failed:', error)
}

/** Excel/ZIP生成時、ローカルIndexedDBに無い写真（他端末アップロード分）をStorageから取得する */
export async function downloadCloudCompressed(storagePath: string): Promise<Blob | null> {
  const url = getCloudPhotoUrl(storagePath)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

// ─── photo_folders（未分類フォルダ） ─────────────────────────

function folderRow(folder: PhotoFolder) {
  return {
    id: folder.id,
    project_id: folder.project_id,
    user_id: folder.user_id,
    name: folder.name,
    parent_folder_id: folder.parent_folder_id ?? null,
    sort_order: folder.sort_order,
    created_at: folder.created_at,
    updated_at: folder.updated_at,
  }
}

export async function fetchCloudFolders(userId: string): Promise<PhotoFolder[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await supabase.from('photo_folders').select('*').eq('user_id', userId)
  if (error) {
    console.error('[cloudSync] fetchCloudFolders failed:', error)
    return []
  }
  return (data ?? []) as PhotoFolder[]
}

export async function insertCloudFolders(folders: PhotoFolder[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || folders.length === 0) return
  const { error } = await supabase.from('photo_folders').insert(folders.map(folderRow))
  if (error) console.error('[cloudSync] insertCloudFolders failed:', error)
}

export async function updateCloudFolder(id: string, data: Partial<PhotoFolder>): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase
    .from('photo_folders')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[cloudSync] updateCloudFolder failed:', error)
}

/** フォルダ削除。photos.folder_id は DB側の on delete set null で自動的にnullへ戻る */
export async function deleteCloudFolder(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase.from('photo_folders').delete().eq('id', id)
  if (error) console.error('[cloudSync] deleteCloudFolder failed:', error)
}
