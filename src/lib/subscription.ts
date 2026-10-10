/**
 * Pro月額Subscription（public.subscriptions）の表示用判定。
 *
 * 契約管理ボタンは plan ではなく「アプリ経由のSubscriptionが残っているか」で出し分ける
 * （plan='pro' は pro_override の開発者アカウントでも立つため）。
 * Proを付与するかどうかの正本はDBの recompute_plan であり、ここは表示にだけ使う。
 */

export interface SubscriptionRow {
  status: string
  cancel_at_period_end: boolean
  current_period_end: string | null
}

/**
 * これらのstatus以外は「契約が残っている」扱いにする（未知のstatusも残っている扱い）。
 * api/create-pro-checkout-session.ts の ENDED_SUBSCRIPTION_STATUSES と同じ定義。
 */
const ENDED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])

/** Proを付与するstatus（migration 0008 の subscription_status_grants_pro と同じ定義）。 */
const PRO_GRANTING_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function isSubscriptionEnded(status: string): boolean {
  return ENDED_SUBSCRIPTION_STATUSES.has(status)
}

export function subscriptionGrantsPro(status: string): boolean {
  return PRO_GRANTING_STATUSES.has(status)
}

/**
 * 契約管理の対象にするSubscriptionを1件選ぶ。終了済みしか無ければ null（ボタンを出さない）。
 * 通常は1ユーザー1件だが、複数ある場合はProを付与しているものを優先する。
 */
export function pickManageableSubscription<T extends SubscriptionRow>(rows: readonly T[]): T | null {
  const live = rows.filter((row) => !isSubscriptionEnded(row.status))
  return live.find((row) => subscriptionGrantsPro(row.status)) ?? live[0] ?? null
}

/** current_period_end（ISO文字列）を「2026年11月9日」の形にする。不正・未設定は null。 */
export function formatPeriodEnd(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  })
}
