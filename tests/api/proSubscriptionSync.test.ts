import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { createFakeSupabase } from './fakes'

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }))

vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}))

import {
  evaluateNewTracking,
  handleProSubscriptionEvent,
  isCancelScheduledAtPeriodEnd,
  isProSubscriptionEvent,
  toSubscriptionSnapshot,
} from '../../api/_lib/proSubscriptionSync'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PERIOD_END = 1794210819 // 2026-11-09（Stripeで確認した実際の値）

/** retrieve で返る Subscription の最小形（dahlia：current_period_end は item 側）。 */
function subscription(overrides: {
  status?: string
  cancel_at?: number | null
  cancel_at_period_end?: boolean
  canceled_at?: number | null
  current_period_end?: number
} = {}): Stripe.Subscription {
  return {
    id: 'sub_test',
    customer: 'cus_test',
    status: overrides.status ?? 'active',
    cancel_at: overrides.cancel_at ?? null,
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    canceled_at: overrides.canceled_at ?? null,
    metadata: { product: 'pro', supabase_user_id: USER_ID },
    items: {
      has_more: false,
      data: [
        {
          price: { id: 'price_pro_test' },
          quantity: 1,
          current_period_end: overrides.current_period_end ?? PERIOD_END,
        },
      ],
    },
  } as unknown as Stripe.Subscription
}

describe('toSubscriptionSnapshot：解約予約（cancelAtPeriodEnd）の判定', () => {
  it('cancel_at_period_end = true なら解約予約あり', () => {
    expect(toSubscriptionSnapshot(subscription({ cancel_at_period_end: true })).cancelAtPeriodEnd).toBe(true)
  })

  it('cancel_at = current_period_end（flexible billing mode の Portal）なら解約予約あり', () => {
    const snapshot = toSubscriptionSnapshot(subscription({ cancel_at: PERIOD_END, cancel_at_period_end: false }))
    expect(snapshot.cancelAtPeriodEnd).toBe(true)
    expect(snapshot.currentPeriodEnd).toBe(new Date(PERIOD_END * 1000).toISOString())
  })

  it('cancel_at = null なら解約予約なし', () => {
    expect(toSubscriptionSnapshot(subscription({ cancel_at: null })).cancelAtPeriodEnd).toBe(false)
  })

  it('解約予約を取り消す（cancel_at が null に戻る）と false に戻る', () => {
    const scheduled = toSubscriptionSnapshot(subscription({ cancel_at: PERIOD_END }))
    // canceled_at は取り消し後も過去の操作時刻が残ることがあるが、判定には使わない
    const renewed = toSubscriptionSnapshot(subscription({ cancel_at: null, canceled_at: PERIOD_END - 86400 }))
    expect(scheduled.cancelAtPeriodEnd).toBe(true)
    expect(renewed.cancelAtPeriodEnd).toBe(false)
  })

  it('status = canceled（終了済み）では cancel_at があっても解約予約として扱わない', () => {
    expect(
      toSubscriptionSnapshot(subscription({ status: 'canceled', cancel_at: PERIOD_END })).cancelAtPeriodEnd,
    ).toBe(false)
  })

  it('cancel_at が current_period_end と異なる（期間途中の任意日付）場合は対象外', () => {
    expect(
      toSubscriptionSnapshot(subscription({ cancel_at: PERIOD_END - 7 * 86400 })).cancelAtPeriodEnd,
    ).toBe(false)
  })

  it('canceled_at だけが入っていても解約予約として扱わない', () => {
    expect(toSubscriptionSnapshot(subscription({ canceled_at: PERIOD_END - 86400 })).cancelAtPeriodEnd).toBe(false)
  })

  it('trialing / past_due の契約でも cancel_at = 期間終了なら解約予約あり', () => {
    for (const status of ['trialing', 'past_due']) {
      expect(isCancelScheduledAtPeriodEnd({ status, cancelAtPeriodEnd: false, cancelAt: PERIOD_END, currentPeriodEnd: PERIOD_END })).toBe(true)
    }
  })

  it('item が複数で current_period_end を特定できない場合、cancel_at だけでは判定しない', () => {
    expect(isCancelScheduledAtPeriodEnd({ status: 'active', cancelAtPeriodEnd: false, cancelAt: PERIOD_END, currentPeriodEnd: undefined })).toBe(false)
  })
})

describe('Pro権限判定に関わる値は変わらない', () => {
  it('解約予約があっても status / priceId / quantity / 新規追跡の判定は従来どおり', () => {
    const snapshot = toSubscriptionSnapshot(subscription({ cancel_at: PERIOD_END }))
    expect(snapshot.status).toBe('active')
    expect(snapshot.priceId).toBe('price_pro_test')
    expect(snapshot.quantity).toBe(1)
    expect(evaluateNewTracking(snapshot, 'price_pro_test')).toEqual({ allowed: true })
  })

  it('広告削除（mode=payment）の checkout.session.completed は Pro 同期の対象外', () => {
    expect(
      isProSubscriptionEvent({
        type: 'checkout.session.completed',
        data: { object: { mode: 'payment' } },
      } as unknown as Stripe.Event),
    ).toBe(false)
    expect(
      isProSubscriptionEvent({
        type: 'customer.subscription.updated',
        data: { object: {} },
      } as unknown as Stripe.Event),
    ).toBe(true)
  })
})

describe('handleProSubscriptionEvent：解約予約がDBへ渡る', () => {
  const ENV_KEYS = ['STRIPE_PRO_PRICE_ID', 'VERCEL_ENV'] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
    process.env.VERCEL_ENV = 'preview'
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    vi.restoreAllMocks()
  })

  async function runUpdatedEvent(latest: Stripe.Subscription) {
    const fake = createFakeSupabase({
      tables: {
        subscriptions: { data: { user_id: USER_ID }, error: null },
        subscription_sync_state: { data: { stripe_subscription_id: 'sub_test' }, error: null },
      },
      rpc: {
        request_subscription_sync: { data: 'requested', error: null },
        acquire_subscription_sync_lease: {
          data: [{ result: 'acquired', lease_token: '33333333-3333-4333-8333-333333333333' }],
          error: null,
        },
        complete_subscription_sync: { data: [{ result: 'applied', needs_resync: false }], error: null },
      },
    })
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(latest) } } as unknown as Stripe

    const outcome = await handleProSubscriptionEvent(
      {
        id: 'evt_test',
        type: 'customer.subscription.updated',
        created: PERIOD_END - 30 * 86400,
        livemode: false,
        data: { object: { id: 'sub_test', metadata: { product: 'pro', supabase_user_id: USER_ID } } },
      } as unknown as Stripe.Event,
      stripe,
      'sk_test_dummy',
      'https://staging-ref.supabase.co',
      'service-role-dummy',
    )
    const completeCall = fake.client.rpc.mock.calls.find(([name]) => name === 'complete_subscription_sync')
    return { outcome, completeArgs: completeCall?.[1] as Record<string, unknown> }
  }

  it('Portal の解約予約（cancel_at = 期間終了）は p_cancel_at_period_end = true で保存される', async () => {
    const { outcome, completeArgs } = await runUpdatedEvent(subscription({ cancel_at: PERIOD_END }))
    expect(outcome.httpStatus).toBe(200)
    expect(completeArgs).toMatchObject({
      p_status: 'active',
      p_price_id: 'price_pro_test',
      p_cancel_at_period_end: true,
      p_current_period_end: new Date(PERIOD_END * 1000).toISOString(),
    })
  })

  it('解約予約の取り消し（cancel_at = null）は p_cancel_at_period_end = false で保存される', async () => {
    const { completeArgs } = await runUpdatedEvent(subscription({ cancel_at: null }))
    expect(completeArgs).toMatchObject({ p_status: 'active', p_cancel_at_period_end: false })
  })
})

describe('handleProSubscriptionEvent：決済済みなのにProが付与されない（ignored）場合の異常ログ', () => {
  const ENV_KEYS = ['STRIPE_PRO_PRICE_ID', 'VERCEL_ENV'] as const
  const saved: Record<string, string | undefined> = {}
  const CONFIG_ERROR = '[stripe-webhook:pro] config_error: paid Pro subscription not applied (price not in stripe_pro_prices)'

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
    process.env.VERCEL_ENV = 'preview'
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    vi.restoreAllMocks()
  })

  /** 未追跡（新規候補）の customer.subscription.created を、complete の結果を指定して処理する。 */
  async function runNewCandidate(completeResult: 'applied' | 'ignored') {
    const fake = createFakeSupabase({
      tables: {
        subscriptions: { data: null, error: null },
        subscription_sync_state: { data: null, error: null },
      },
      rpc: {
        request_subscription_sync: { data: 'requested', error: null },
        acquire_subscription_sync_lease: {
          data: [{ result: 'acquired', lease_token: '33333333-3333-4333-8333-333333333333' }],
          error: null,
        },
        complete_subscription_sync: { data: [{ result: completeResult, needs_resync: false }], error: null },
      },
    })
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription()) } } as unknown as Stripe

    const outcome = await handleProSubscriptionEvent(
      {
        id: 'evt_created',
        type: 'customer.subscription.created',
        created: PERIOD_END - 30 * 86400,
        livemode: false,
        data: { object: { id: 'sub_test', metadata: { product: 'pro', supabase_user_id: USER_ID } } },
      } as unknown as Stripe.Event,
      stripe,
      'sk_test_dummy',
      'https://staging-ref.supabase.co',
      'service-role-dummy',
    )
    const completeCall = fake.client.rpc.mock.calls.find(([name]) => name === 'complete_subscription_sync')
    return { outcome, completeArgs: completeCall?.[1] as Record<string, unknown> }
  }

  function configErrorCalls() {
    return vi.mocked(console.error).mock.calls.filter(([message]) => message === CONFIG_ERROR)
  }

  it('allowNewTracking = true なのに ignored なら error ログを残す（応答は従来どおり 200 / ignored）', async () => {
    const { outcome, completeArgs } = await runNewCandidate('ignored')

    expect(completeArgs).toMatchObject({ p_allow_new_tracking: true, p_price_id: 'price_pro_test' })
    expect(outcome).toEqual({ httpStatus: 200, body: { received: true, result: 'ignored' } })
    expect(configErrorCalls()).toHaveLength(1)
    expect(configErrorCalls()[0][1]).toMatchObject({
      eventId: 'evt_created',
      eventType: 'customer.subscription.created',
      subscriptionId: 'sub_test',
      priceId: 'price_pro_test',
      status: 'active',
    })
  })

  it('異常ログにユーザーID・APIキー・service_roleキーを含めない', async () => {
    await runNewCandidate('ignored')
    const logged = JSON.stringify(configErrorCalls())
    expect(logged).not.toContain(USER_ID)
    expect(logged).not.toContain('sk_test_dummy')
    expect(logged).not.toContain('service-role-dummy')
  })

  it('applied なら異常ログは出さない（正常な付与は従来どおり）', async () => {
    const { outcome } = await runNewCandidate('applied')
    expect(outcome).toEqual({ httpStatus: 200, body: { received: true, result: 'applied' } })
    expect(configErrorCalls()).toHaveLength(0)
  })

  it('Webhook側で新規追跡を許可しなかった ignored（Price が STRIPE_PRO_PRICE_ID と違う等）は対象外', async () => {
    process.env.STRIPE_PRO_PRICE_ID = 'price_other'
    const { outcome, completeArgs } = await runNewCandidate('ignored')
    expect(completeArgs).toMatchObject({ p_allow_new_tracking: false })
    expect(outcome.httpStatus).toBe(200)
    expect(configErrorCalls()).toHaveLength(0)
  })
})
