import type { Plan } from '@/types/auth'

/**
 * プラン別の機能制限をまとめる場所。
 * 「どのplanに何が許可されるか」をコンポーネントに直接書き散らさないよう、
 * 判定ロジックはここに集約する。
 *
 * 現場フォトは完全無料化した（広告削除プラン・Proプランの新規購入は終了）。機能の制限はどのplanにもなく、
 * 工事案件数・Excel出力は全ユーザーで同じ。違いは広告の表示だけで、過去に広告削除（買い切り）を
 * 購入した人（ads_removed）とPro契約・恒久Pro（pro）には、従来どおり広告を表示しない（購入者の権利の保護）。
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

/** 広告を表示するか（true: 表示する / false: 表示しない）。free のみ表示し、ads_removed と pro は表示しない。 */
export function shouldShowAds(plan: Plan): boolean {
  return plan === 'free'
}
