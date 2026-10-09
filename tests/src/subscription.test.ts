import { describe, expect, it } from 'vitest'
import { formatPeriodEnd, pickManageableSubscription, subscriptionGrantsPro } from '@/lib/subscription'

const row = (status: string, cancel_at_period_end = false) => ({
  status,
  cancel_at_period_end,
  current_period_end: '2026-11-09T03:00:00.000Z',
})

describe('契約管理カードの表示判定', () => {
  it('Subscriptionが無い（pro_overrideのみ・広告削除の買い切りのみ）ならカードを出さない', () => {
    expect(pickManageableSubscription([])).toBeNull()
  })

  it('終了済み（canceled / incomplete_expired）だけならカードを出さない', () => {
    expect(pickManageableSubscription([row('canceled'), row('incomplete_expired')])).toBeNull()
  })

  it('active / past_due / 解約予約中（cancel_at_period_end）はカードを出す', () => {
    expect(pickManageableSubscription([row('active')])?.status).toBe('active')
    expect(pickManageableSubscription([row('past_due')])?.status).toBe('past_due')
    expect(pickManageableSubscription([row('active', true)])?.cancel_at_period_end).toBe(true)
  })

  it('unpaid など Pro を付与しない継続中の契約もカードを出す（支払い状況を確認できるように）', () => {
    expect(pickManageableSubscription([row('unpaid')])?.status).toBe('unpaid')
    expect(subscriptionGrantsPro('unpaid')).toBe(false)
  })

  it('複数ある場合はProを付与しているものを優先する', () => {
    expect(pickManageableSubscription([row('canceled'), row('unpaid'), row('active')])?.status).toBe('active')
  })
})

describe('formatPeriodEnd', () => {
  it('日本時間の日付で表示する', () => {
    expect(formatPeriodEnd('2026-11-08T16:00:00.000Z')).toBe('2026年11月9日')
  })

  it('未設定・不正な値は null', () => {
    expect(formatPeriodEnd(null)).toBeNull()
    expect(formatPeriodEnd('invalid')).toBeNull()
  })
})
