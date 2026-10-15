/**
 * 写真取得API（create-genbafoto-job）の認可ロジック（純粋関数）。
 *
 * 署名付きURLを発行する「前」に、次のすべてを確認する。1つでも満たさなければ、署名付きURLは発行しない：
 *   1. 要求した写真が、認証済みユーザー本人の写真だけであること（他人・存在しない写真が混ざっていない）
 *   2. 各写真の工事案件も、認証済みユーザー本人のものであること
 *   3. 工事案件が削除済み（deleted_at あり）でないこと
 *   4. storage_path が、アップロード処理（src/lib/cloudSync.ts の uploadCompressedToCloud）が作る形式
 *        `${認証済みユーザーID}/${写真ID}.jpg`
 *      と「完全一致」すること（他ユーザーのフォルダ・他の写真ID・余計なパス・パストラバーサル・拡張子違いを許可しない）
 *
 * 呼び出し側は、利用者のJWTを付けたクライアント（RLSが効く）で取得した行を渡す。ここではRLSに頼り切らず、
 * 行の user_id なども明示的に確認する（service_role で署名する前の最後の関門）。
 *
 * 失敗時の応答は固定の文言だけで、他ユーザーの写真情報・storage_path・署名付きURLを含めない。
 * `reason` はサーバーログ用の分類で、応答には出さない。
 */

/** 本人以外・存在しない・削除済みなど、アクセスできない写真が含まれる場合の応答（従来と同じ文言・403） */
export const PHOTO_ACCESS_DENIED_MESSAGE = '指定された写真の一部にアクセスできません'

/** Cloud同期が完了していない（storage_path が無い）写真が含まれる場合の応答（従来と同じ文言・409） */
export const PHOTO_UNSYNCED_MESSAGE = '同期が完了していない写真が含まれています'

/** アップロード処理が作る保存パス。署名付きURLを発行してよいパスは、これと完全一致するものだけ。 */
export function expectedStoragePath(userId: string, photoId: string): string {
  return `${userId}/${photoId}.jpg`
}

export type PhotoAccessFailureReason =
  | 'invalid_user'
  | 'photo_not_accessible'
  | 'project_not_accessible'
  | 'project_deleted'
  | 'unsynced'
  | 'invalid_storage_path'

export type PhotoAccessResult =
  | { ok: true; photos: { id: string; storagePath: string }[] }
  | { ok: false; status: 403 | 409; error: string; reason: PhotoAccessFailureReason }

export interface PhotoAccessInput {
  /** 認証（JWT検証）で確定したユーザーID。リクエスト本文のユーザー申告は使わない。 */
  userId: string
  /** リクエストで指定された写真ID（重複除去済み） */
  requestedPhotoIds: readonly string[]
  /** photos から取得した行（id, user_id, project_id, storage_path） */
  photoRows: readonly unknown[] | null
  /** projects から取得した行（id, user_id, deleted_at） */
  projectRows: readonly unknown[] | null
}

function denied(reason: PhotoAccessFailureReason): PhotoAccessResult {
  return { ok: false, status: 403, error: PHOTO_ACCESS_DENIED_MESSAGE, reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validatePhotoAccess(input: PhotoAccessInput): PhotoAccessResult {
  const { userId, requestedPhotoIds, photoRows, projectRows } = input

  if (typeof userId !== 'string' || userId.length === 0) return denied('invalid_user')
  if (!Array.isArray(photoRows) || !Array.isArray(projectRows)) return denied('photo_not_accessible')

  // ── 1. 写真の所有 ─────────────────────────────────────────────
  // 要求数と取得数が一致しない＝本人が所有しない（または存在しない）写真が混ざっている。部分成功にはしない。
  if (photoRows.length !== requestedPhotoIds.length) return denied('photo_not_accessible')

  const requested = new Set(requestedPhotoIds)
  const seen = new Set<string>()
  const photos: { id: string; userId: string; projectId: string; storagePath: unknown }[] = []
  for (const row of photoRows) {
    if (!isRecord(row)) return denied('photo_not_accessible')
    const { id, user_id: ownerId, project_id: projectId, storage_path: storagePath } = row
    if (typeof id !== 'string' || !requested.has(id) || seen.has(id)) return denied('photo_not_accessible')
    seen.add(id)
    // RLS で絞られているはずの行でも、所有者を明示的に確認する
    if (ownerId !== userId) return denied('photo_not_accessible')
    if (typeof projectId !== 'string' || projectId.length === 0) return denied('project_not_accessible')
    photos.push({ id, userId: ownerId, projectId, storagePath })
  }

  // ── 2・3. 工事案件の所有と削除済みでないこと ───────────────────────
  const projects = new Map<string, Record<string, unknown>>()
  for (const row of projectRows) {
    if (isRecord(row) && typeof row.id === 'string') projects.set(row.id, row)
  }
  for (const photo of photos) {
    const project = projects.get(photo.projectId)
    if (!project || project.user_id !== userId) return denied('project_not_accessible')
    if (project.deleted_at != null) return denied('project_deleted')
  }

  // ── 同期未完了（従来どおり 409。署名はしない）──────────────────────
  if (photos.some((p) => typeof p.storagePath !== 'string' || p.storagePath.trim().length === 0)) {
    return { ok: false, status: 409, error: PHOTO_UNSYNCED_MESSAGE, reason: 'unsynced' }
  }

  // ── 4. storage_path の完全一致 ───────────────────────────────
  for (const photo of photos) {
    if (photo.storagePath !== expectedStoragePath(userId, photo.id)) return denied('invalid_storage_path')
  }

  return { ok: true, photos: photos.map((p) => ({ id: p.id, storagePath: p.storagePath as string })) }
}
