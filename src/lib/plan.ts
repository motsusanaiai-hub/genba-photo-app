import type { Plan } from '@/types/auth'

/**
 * プラン別の機能制限をまとめる場所。
 * 「どのplanに何が許可されるか」をコンポーネントに直接書き散らさないよう、
 * 判定ロジックはここに集約する。
 *
 * 現場フォトは完全無料化した（広告削除プラン・Proプランは廃止）。全ユーザーに同じ機能を無料で提供し、
 * 広告は全ユーザーに表示する。そのため、以下の判定はどのplanでも同じ結果を返す。
 * 判定関数と plan 引数は、判定の入口を1か所に保つため、また将来の拡張に備えて残している
 * （plan 列・課金テーブル・Webhook などの購入履歴は削除していない）。
 *
 * セキュリティや安定運用のための制限（認証・所有者確認・RLS、API の写真件数上限など）は、
 * 料金とは関係なく、ここではなく各 API・DB 側に残してある。
 */

/** 工事案件の保存数上限。nullは無制限（全プラン共通）。 */
export function projectLimit(_plan: Plan): number | null {
  return null
}

/** 現在の工事案件数から見て、新規作成が許可されるか（現在件数が上限未満か） */
export function canCreateProject(plan: Plan, currentProjectCount: number): boolean {
  const limit = projectLimit(plan)
  return limit === null || currentProjectCount < limit
}

/**
 * Excel出力を全ページ一括で行えるか（全プラン共通で true）。
 * false の場合は1ページずつの選択出力になる（ページ選択UIは将来のために残している）。
 */
export function canExportAllExcelPages(_plan: Plan): boolean {
  return true
}

/** 広告を表示するか（全プラン共通で true）。 */
export function shouldShowAds(_plan: Plan): boolean {
  return true
}
