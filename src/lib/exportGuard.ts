import { useAuthStore } from '@/store/authStore'
import { ownsRecord, resolveExportTargets, resolveOwnerId } from '@/lib/ownership'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

/**
 * ZIP・Excel・genbafoto の出力の入口で、出力対象がログイン中のユーザー本人のものか確認する。
 * 画面側の非表示だけに頼らず、出力処理そのものでも他人の工事案件・写真を出力しない。
 * 本人のものでなければ null（呼び出し側は何も出力しない）。他人の写真が混ざっていれば取り除く。
 */
export function guardExportTargets(project: Project, photos: readonly Photo[]): { project: Project; photos: Photo[] } | null {
  const ownerId = resolveOwnerId(useAuthStore.getState())
  return resolveExportTargets(project, photos, ownerId)
}

/** Excel 出力が拒否されたとき。利用者向けの文言には、他人のデータの有無を含めない */
export class ExportNotAllowedError extends Error {
  constructor() {
    super('出力できませんでした。')
    this.name = 'ExportNotAllowedError'
  }
}

export function requireExportTargets(project: Project, photos: readonly Photo[]): { project: Project; photos: Photo[] } {
  const targets = guardExportTargets(project, photos)
  if (!targets) throw new ExportNotAllowedError()
  return targets
}

/** 端末内の画像（IndexedDB）を読む前の確認。ログイン中のユーザー本人の写真だけ true */
export function isCurrentUsersPhoto(photo: Pick<Photo, 'user_id'>): boolean {
  return ownsRecord(resolveOwnerId(useAuthStore.getState()), photo)
}
