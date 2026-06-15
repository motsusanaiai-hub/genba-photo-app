import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Project } from '@/types/project'
import type { Photo } from '@/types/photo'

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

export async function deleteCloudProject(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) console.error('[cloudSync] deleteCloudProject failed:', error)
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
