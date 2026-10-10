import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import {
  attachPlanRefreshOnVisible,
  createPlanRefreshTrigger,
  isPlan,
  pollPlanUntil,
  refreshPlan,
} from '@/lib/planRefresh'
import type { AppUser, Plan } from '@/types/auth'

// プラン表示の更新（F5 なしで profiles.plan を反映する）。
// DB取得は差し替え可能な関数として渡し、Supabase には接続しない。

const USER: AppUser = { id: 'user-1', email: 'user@example.com', display_name: 'user', plan: 'free' }

function setPlan(plan: Plan) {
  useAuthStore.setState({ user: { ...USER, plan }, initialized: true })
}

function storePlan(): Plan | undefined {
  return useAuthStore.getState().user?.plan
}

/** 呼ばれるたびに順番に plan を返す取得関数（最後の値を繰り返す）。 */
function sequence(...plans: Array<Plan | null>) {
  let i = 0
  return vi.fn(async (_userId: string) => plans[Math.min(i++, plans.length - 1)])
}

const noSleep = vi.fn(async (_ms: number) => {})

beforeEach(() => {
  useAuthStore.setState({ user: null, initialized: true })
  noSleep.mockClear()
})

describe('refreshPlan：取得した plan を authStore に反映する', () => {
  it('Pro購入後：free → pro に更新される', async () => {
    setPlan('free')
    const fetch = sequence('pro')
    await expect(refreshPlan(fetch)).resolves.toBe('pro')
    expect(fetch).toHaveBeenCalledWith('user-1')
    expect(storePlan()).toBe('pro')
  })

  it('解約・契約終了後：pro → free に更新される', async () => {
    setPlan('pro')
    await refreshPlan(sequence('free'))
    expect(storePlan()).toBe('free')
  })

  it('Pro終了後：広告削除購入者は pro → ads_removed に戻る', async () => {
    setPlan('pro')
    await refreshPlan(sequence('ads_removed'))
    expect(storePlan()).toBe('ads_removed')
  })

  it('ads_removed → pro に更新される', async () => {
    setPlan('ads_removed')
    await refreshPlan(sequence('pro'))
    expect(storePlan()).toBe('pro')
  })

  it('plan 以外のユーザー情報（id・メール・表示名）は変えない', async () => {
    setPlan('free')
    await refreshPlan(sequence('pro'))
    expect(useAuthStore.getState().user).toEqual({ ...USER, plan: 'pro' })
  })

  it('plan が同じなら authStore を更新しない（不要な再描画をしない）', async () => {
    setPlan('pro')
    const before = useAuthStore.getState().user
    await refreshPlan(sequence('pro'))
    expect(useAuthStore.getState().user).toBe(before)
  })

  it('取得に失敗した場合は現在の表示を維持する', async () => {
    setPlan('pro')
    await expect(refreshPlan(sequence(null))).resolves.toBeNull()
    await expect(refreshPlan(vi.fn(async () => Promise.reject(new Error('offline'))))).resolves.toBeNull()
    expect(storePlan()).toBe('pro')
  })

  it('未ログインなら取得しない', async () => {
    const fetch = sequence('pro')
    await expect(refreshPlan(fetch)).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('取得中にログアウト・別ユーザーに切り替わった場合は反映しない', async () => {
    setPlan('free')
    const fetch = vi.fn(async () => {
      useAuthStore.setState({ user: { ...USER, id: 'user-2', plan: 'free' } })
      return 'pro' as Plan
    })
    await refreshPlan(fetch)
    expect(useAuthStore.getState().user).toEqual({ ...USER, id: 'user-2', plan: 'free' })
  })

  it('既存の3プラン以外の値は plan として扱わない', () => {
    expect(['free', 'ads_removed', 'pro'].every(isPlan)).toBe(true)
    expect(isPlan('premium')).toBe(false)
    expect(isPlan(null)).toBe(false)
  })
})

describe('pollPlanUntil：Pro購入後の Webhook 反映待ち', () => {
  const isPro = (plan: Plan) => plan === 'pro'

  it('すぐ反映されていれば1回で終了する', async () => {
    setPlan('free')
    const fetch = sequence('pro')
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 15, intervalMs: 2000,
      refresh: () => refreshPlan(fetch), sleep: noSleep,
    })
    expect(result).toEqual({ status: 'reflected', plan: 'pro' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(noSleep).not.toHaveBeenCalled()
    expect(storePlan()).toBe('pro')
  })

  it('Webhook が遅れても、反映された時点で再確認を終了する', async () => {
    setPlan('free')
    const fetch = sequence('free', 'free', 'pro', 'pro')
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 15, intervalMs: 2000,
      refresh: () => refreshPlan(fetch), sleep: noSleep,
    })
    expect(result).toEqual({ status: 'reflected', plan: 'pro' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(noSleep.mock.calls).toEqual([[2000], [2000]])
    expect(storePlan()).toBe('pro')
  })

  it('ads_removed のユーザーは、free 以外でも pro になるまで待つ', async () => {
    setPlan('ads_removed')
    const fetch = sequence('ads_removed', 'pro')
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 15, intervalMs: 2000,
      refresh: () => refreshPlan(fetch), sleep: noSleep,
    })
    expect(result).toEqual({ status: 'reflected', plan: 'pro' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('反映されない場合は上限回数で打ち切る（無制限に待たない）', async () => {
    setPlan('free')
    const fetch = sequence('free')
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 15, intervalMs: 2000,
      refresh: () => refreshPlan(fetch), sleep: noSleep,
    })
    expect(result).toEqual({ status: 'timeout' })
    expect(fetch).toHaveBeenCalledTimes(15)
    expect(noSleep).toHaveBeenCalledTimes(14)
    expect(storePlan()).toBe('free')
  })

  it('取得失敗が続いてもタイムアウトで終了する', async () => {
    setPlan('free')
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 3, intervalMs: 2000,
      refresh: () => refreshPlan(sequence(null)), sleep: noSleep,
    })
    expect(result).toEqual({ status: 'timeout' })
  })

  it('画面を離れたら（キャンセル）それ以上取得しない', async () => {
    setPlan('free')
    let cancelled = false
    const fetch = vi.fn(async () => {
      cancelled = true
      return 'free' as Plan
    })
    const result = await pollPlanUntil({
      isReflected: isPro, maxAttempts: 15, intervalMs: 2000,
      refresh: () => refreshPlan(fetch), sleep: noSleep, isCancelled: () => cancelled,
    })
    expect(result).toEqual({ status: 'cancelled' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('createPlanRefreshTrigger：連続イベントによる過剰な再取得の防止', () => {
  it('最短間隔内の連続呼び出しは1回にまとめ、間隔を過ぎたら再取得する', async () => {
    let now = 0
    const refresh = vi.fn(async () => {})
    const trigger = createPlanRefreshTrigger({ refresh, minIntervalMs: 30_000, now: () => now })

    await expect(trigger()).resolves.toBe(true)
    now = 1_000
    await expect(trigger()).resolves.toBe(false)
    now = 29_999
    await expect(trigger()).resolves.toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)

    now = 30_000
    await expect(trigger()).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('取得中に来た呼び出しは新しい取得をしない', async () => {
    let release!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const trigger = createPlanRefreshTrigger({ refresh, minIntervalMs: 0 })

    const first = trigger()
    await expect(trigger()).resolves.toBe(false)
    await expect(trigger()).resolves.toBe(false)
    release()
    await expect(first).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('オフラインのときは取得しない（写真管理などの既存機能に影響させない）', async () => {
    const refresh = vi.fn(async () => {})
    const trigger = createPlanRefreshTrigger({ refresh, minIntervalMs: 0, isOnline: () => false })
    await expect(trigger()).resolves.toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('取得が失敗しても例外を外に出さず、次の呼び出しで再試行できる', async () => {
    let now = 0
    const refresh = vi.fn(async () => Promise.reject(new Error('network')))
    const trigger = createPlanRefreshTrigger({ refresh, minIntervalMs: 30_000, now: () => now })
    await expect(trigger()).resolves.toBe(true)
    now = 30_000
    await expect(trigger()).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

describe('attachPlanRefreshOnVisible：タブ再表示・focus での再取得', () => {
  function setup() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const win = new EventTarget()
    const trigger = vi.fn()
    const detach = attachPlanRefreshOnVisible({ doc, win, trigger })
    return { doc, win, trigger, detach }
  }

  it('タブが表示されたときと focus で trigger を呼ぶ', () => {
    const { doc, win, trigger } = setup()
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('focus'))
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('タブが非表示になったときは呼ばない', () => {
    const { doc, trigger } = setup()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(trigger).not.toHaveBeenCalled()
  })

  it('解除後はイベントが来ても呼ばない', () => {
    const { doc, win, trigger, detach } = setup()
    detach()
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('focus'))
    expect(trigger).not.toHaveBeenCalled()
  })

  it('再表示と focus が同時に来ても、最短間隔の制御で取得は1回になる', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const win = new EventTarget()
    const refresh = vi.fn(async () => {})
    const trigger = createPlanRefreshTrigger({ refresh, minIntervalMs: 30_000, now: () => 0 })
    attachPlanRefreshOnVisible({ doc, win, trigger })

    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('focus'))
    doc.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
