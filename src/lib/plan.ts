import type { Plan } from '@/types/auth'

/**
 * プラン別の機能制限をまとめる場所。
 * 「どのplanに何が許可されるか」をコンポーネントに直接書き散らさないよう、
 * 判定ロジックはここに集約する。
 */

/** free / ads_removed の現場保存数上限 */
export const FREE_PROJECT_LIMIT = 3

/** 上限到達時にユーザーへ表示する説明文（購入導線・リンクは含めない） */
export const PROJECT_LIMIT_MESSAGE =
  '現在のプランでは現場を3件まで保存できます。不要な現場を削除するか、Proプランをご利用ください。'

/** そのplanでの現場保存数上限。nullは無制限（pro）。 */
export function projectLimit(plan: Plan): number | null {
  return plan === 'pro' ? null : FREE_PROJECT_LIMIT
}

/** 現在の現場数から見て、新規作成が許可されるか（現在件数が上限未満か） */
export function canCreateProject(plan: Plan, currentProjectCount: number): boolean {
  const limit = projectLimit(plan)
  return limit === null || currentProjectCount < limit
}

/** Excel出力を全ページ一括で行えるか（false の場合は1ページずつの選択出力になる） */
export function canExportAllExcelPages(plan: Plan): boolean {
  return plan === 'pro'
}

/** Excelページ選択UIに表示する説明文（購入導線・リンクは含めない） */
export const EXCEL_PAGE_LIMIT_MESSAGE =
  '現在のプランでは、Excel出力は1回につき1ページのみとなります。全ページを出力するにはProプランをご利用ください。'

/** 広告を表示するプランか（true: 表示する / false: 表示しない）。ads_removed購入済みとproは非表示。 */
export function shouldShowAds(plan: Plan): boolean {
  return plan === 'free'
}
