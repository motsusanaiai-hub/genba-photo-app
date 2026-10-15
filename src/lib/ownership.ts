import type { Photo, PhotoFolder } from '@/types/photo'
import type { Project } from '@/types/project'

/**
 * 端末内のデータ（工事案件・写真・フォルダ）の所有者判定。
 *
 * ログアウトしても、端末内の工事案件・写真のメタ情報（localStorage）・原本と圧縮画像（IndexedDB）は消さない設計。
 * そのため同じ端末で別のユーザーがログインしたとき、前のユーザーのデータが端末内に残っている。
 * それを他のユーザーに見せない・操作させない・出力させないために、ログイン中のユーザーIDを基準に、
 * 次をすべて満たすデータだけを扱う：
 *   - ユーザーIDが確定している（未ログイン・認証の確認前は「誰のデータも扱えない」）
 *   - 工事案件の user_id が、ログイン中のユーザーと一致する
 *   - 写真・フォルダの user_id が一致し、かつ、本人の工事案件に属している
 * これは端末内の表示・操作の分離であり、Supabase の RLS や API の認可（STEP 7-A）の代わりではない。
 */

/** ユーザーIDが有効な値（空文字・null・undefined は「確定していない」） */
export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** 認証ストアの状態から、データを扱ってよいユーザーIDを返す。未ログイン・認証の確認前は null。 */
export function resolveOwnerId(auth: { user: { id: string } | null; initialized: boolean }): string | null {
  return auth.initialized && auth.user && isUserId(auth.user.id) ? auth.user.id : null
}

/** record の user_id が ownerId と一致するか（ownerId が確定していなければ常に false） */
export function ownsRecord(ownerId: string | null | undefined, record: { user_id?: unknown } | null | undefined): boolean {
  return isUserId(ownerId) && !!record && record.user_id === ownerId
}

/** 本人の工事案件だけを返す。他人・存在しない・未ログイン・認証の確認前は undefined。 */
export function findOwnedProject(
  projects: readonly Project[],
  projectId: string | null | undefined,
  ownerId: string | null | undefined,
): Project | undefined {
  if (!isUserId(ownerId) || !projectId) return undefined
  const project = projects.find((p) => p.id === projectId)
  return ownsRecord(ownerId, project) ? project : undefined
}

/** 本人の工事案件のID一覧 */
export function ownedProjectIds(projects: readonly Project[], ownerId: string | null | undefined): Set<string> {
  return new Set(projects.filter((p) => ownsRecord(ownerId, p)).map((p) => p.id))
}

/**
 * 指定した工事案件の写真のうち、表示・操作してよいものだけ。
 * 工事案件が本人のものでなければ空。写真の user_id も本人であること。
 */
export function filterOwnedProjectPhotos(
  photos: readonly Photo[],
  projects: readonly Project[],
  projectId: string,
  ownerId: string | null | undefined,
): Photo[] {
  if (!findOwnedProject(projects, projectId, ownerId)) return []
  return photos.filter((p) => p.project_id === projectId && ownsRecord(ownerId, p))
}

/** 指定した工事案件のフォルダのうち、表示・操作してよいものだけ（写真と同じ条件） */
export function filterOwnedProjectFolders(
  folders: readonly PhotoFolder[],
  projects: readonly Project[],
  projectId: string,
  ownerId: string | null | undefined,
): PhotoFolder[] {
  if (!findOwnedProject(projects, projectId, ownerId)) return []
  return folders.filter((f) => f.project_id === projectId && ownsRecord(ownerId, f))
}

/** 写真が本人のもので、本人の工事案件に属しているか（写真IDを直接指定された場合の確認用） */
export function isOwnedPhoto(
  photo: Pick<Photo, 'user_id' | 'project_id'> | null | undefined,
  projects: readonly Project[],
  ownerId: string | null | undefined,
): boolean {
  return !!photo && ownsRecord(ownerId, photo) && !!findOwnedProject(projects, photo.project_id, ownerId)
}

/**
 * ZIP・Excel などの出力対象。工事案件が本人のものでなければ null（何も出力しない）。
 * 写真は本人のもの、かつその工事案件の写真だけに絞る（他人の写真が混ざっていても出力に含めない）。
 */
export function resolveExportTargets(
  project: Project,
  photos: readonly Photo[],
  ownerId: string | null | undefined,
): { project: Project; photos: Photo[] } | null {
  if (!ownsRecord(ownerId, project)) return null
  return { project, photos: photos.filter((p) => p.project_id === project.id && ownsRecord(ownerId, p)) }
}
