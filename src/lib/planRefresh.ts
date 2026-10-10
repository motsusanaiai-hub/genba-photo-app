import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { Plan } from '@/types/auth'

/**
 * profiles.plan の再取得（F5 なしでプラン表示を最新にするため）。
 *
 * - plan の正本はDB（Webhook → recompute_plan が更新する）。ここは読むだけで、
 *   authStore の user.plan だけを差し替える。工事案件・写真・フォルダには一切触れない。
 * - 取得に失敗した・オフライン・値が不正な場合は何もしない（現在の表示を維持する）。
 * - user.id は変えないため、useCloudSync（user.id で一度だけ同期）は再実行されない。
 */

const PLANS: readonly Plan[] = ['free', 'ads_removed', 'pro']

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
}

/** 指定ユーザーの profiles.plan をDBから取得する。取得できない場合は null。 */
export async function fetchPlan(userId: string): Promise<Plan | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('profiles').select('plan').eq('id', userId).single()
  if (error || !data) return null
  return isPlan(data.plan) ? data.plan : null
}

/**
 * 現在のログインユーザーの plan を取得し、変わっていれば authStore に反映する。
 * 取得中にログアウト・別ユーザーへの切り替えがあった場合は反映しない。
 * 戻り値は取得できた plan（取得できなければ null）。
 */
export async function refreshPlan(fetch: (userId: string) => Promise<Plan | null> = fetchPlan): Promise<Plan | null> {
  const user = useAuthStore.getState().user
  if (!user) return null

  let plan: Plan | null
  try {
    plan = await fetch(user.id)
  } catch {
    return null
  }
  if (plan === null) return null

  const current = useAuthStore.getState().user
  if (current && current.id === user.id && current.plan !== plan) {
    useAuthStore.getState().setUser({ ...current, plan })
  }
  return plan
}

/** 決済後の反映待ちの結果。 */
export type PollResult = { status: 'reflected'; plan: Plan } | { status: 'timeout' } | { status: 'cancelled' }

/**
 * Webhook の反映待ち用：plan を最大 maxAttempts 回まで取得し、isReflected を満たしたら終了する。
 * 無制限には繰り返さない（最大待ち時間 ≒ intervalMs × (maxAttempts - 1)）。
 */
export async function pollPlanUntil(options: {
  isReflected: (plan: Plan) => boolean
  maxAttempts: number
  intervalMs: number
  refresh?: () => Promise<Plan | null>
  sleep?: (ms: number) => Promise<void>
  isCancelled?: () => boolean
}): Promise<PollResult> {
  const refresh = options.refresh ?? (() => refreshPlan())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const isCancelled = options.isCancelled ?? (() => false)

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (isCancelled()) return { status: 'cancelled' }
    const plan = await refresh()
    if (isCancelled()) return { status: 'cancelled' }
    if (plan !== null && options.isReflected(plan)) return { status: 'reflected', plan }
    if (attempt < options.maxAttempts) await sleep(options.intervalMs)
  }
  return { status: 'timeout' }
}

/**
 * 短時間の連続呼び出しをまとめる。
 * - 実行中の呼び出しがあれば、それが終わるまで新しい取得はしない
 * - 前回の取得開始から minIntervalMs 未満なら取得しない
 * - オフライン（isOnline() が false）のときは取得しない
 */
export function createPlanRefreshTrigger(options: {
  refresh: () => Promise<unknown>
  minIntervalMs: number
  now?: () => number
  isOnline?: () => boolean
}): () => Promise<boolean> {
  const now = options.now ?? (() => Date.now())
  const isOnline = options.isOnline ?? (() => true)
  let inFlight = false
  let lastStartedAt: number | null = null

  return async () => {
    if (inFlight || !isOnline()) return false
    const startedAt = now()
    if (lastStartedAt !== null && startedAt - lastStartedAt < options.minIntervalMs) return false

    inFlight = true
    lastStartedAt = startedAt
    try {
      await options.refresh()
    } catch {
      // 取得失敗は表示を変えないだけ（次の再表示で再試行される）
    } finally {
      inFlight = false
    }
    return true
  }
}

interface ListenerTarget {
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/**
 * タブの再表示（visibilitychange で visible になったとき）とウィンドウの focus で trigger を呼ぶ。
 * 戻り値はイベントの登録を解除する関数。
 */
export function attachPlanRefreshOnVisible(options: {
  doc: ListenerTarget & { visibilityState: string }
  win: ListenerTarget
  trigger: () => unknown
}): () => void {
  const { doc, win, trigger } = options
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') void trigger()
  }
  const onFocus = () => {
    void trigger()
  }
  doc.addEventListener('visibilitychange', onVisibilityChange)
  win.addEventListener('focus', onFocus)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    win.removeEventListener('focus', onFocus)
  }
}
