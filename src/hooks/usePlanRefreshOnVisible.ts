import { useEffect } from 'react'
import { isSupabaseConfigured } from '@/lib/supabase'
import { attachPlanRefreshOnVisible, createPlanRefreshTrigger, refreshPlan } from '@/lib/planRefresh'

/** タブ再表示・focus での再取得の最短間隔（focus と visibilitychange が連続して来ても1回にまとめる）。 */
export const PLAN_REFRESH_MIN_INTERVAL_MS = 30_000

/**
 * タブの再表示・ウィンドウの focus で profiles.plan を再取得する
 * （別タブ・別端末での購入や、契約の終了を F5 なしで反映するため）。
 * オフライン時・取得中・前回から30秒以内は取得しない。取得に失敗しても表示は変えない。
 */
export function usePlanRefreshOnVisible() {
  useEffect(() => {
    if (!isSupabaseConfigured) return

    const trigger = createPlanRefreshTrigger({
      refresh: () => refreshPlan(),
      minIntervalMs: PLAN_REFRESH_MIN_INTERVAL_MS,
      isOnline: () => navigator.onLine,
    })
    return attachPlanRefreshOnVisible({ doc: document, win: window, trigger })
  }, [])
}
