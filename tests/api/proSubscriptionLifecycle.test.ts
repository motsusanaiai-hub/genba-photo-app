import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { createFakeSupabase } from './fakes'

// Pro契約の終了（customer.subscription.deleted）まわりの同期処理のテスト。
// DB側の recompute_plan（plan の再計算）は SQL のため、ここでは
// 「complete_subscription_sync に何が渡るか」までを検証する。

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }))

vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}))

import { handleProSubscriptionEvent } from '../../api/_lib/proSubscriptionSync'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const PERIOD_END = 1794210819
const LEASE_TOKEN = '33333333-3333-4333-8333-333333333333'

/** Pro同期が使ってよいRPC（すべて 0008 の SECURITY DEFINER 関数）。 */
const SYNC_RPCS = new Set([
  'request_subscription_sync',
  'acquire_subscription_sync_lease',
  'complete_subscription_sync',
  'release_subscription_sync_lease',
])

function stripeSubscription(overrides: { status?: string; metadataUserId?: string } = {}): Stripe.Subscription {
  return {
    id: 'sub_test',
    customer: 'cus_test',
    status: overrides.status ?? 'canceled',
    cancel_at: PERIOD_END,
    cancel_at_period_end: false,
    canceled_at: PERIOD_END - 20 * 86400,
    metadata: { product: 'pro', supabase_user_id: overrides.metadataUserId ?? USER_ID },
    items: {
      has_more: false,
      data: [{ price: { id: 'price_pro_test' }, quantity: 1, current_period_end: PERIOD_END }],
    },
  } as unknown as Stripe.Subscription
}

function event(type: string, id: string, object: Record<string, unknown>): Stripe.Event {
  return {
    id,
    type,
    created: PERIOD_END,
    livemode: false,
    data: { object: { id: 'sub_test', ...object } },
  } as unknown as Stripe.Event
}

/**
 * Supabase のフェイク。request_subscription_sync は stripe_webhook_events 台帳を模して
 * 同じ event_id の2回目を 'duplicate_done' にする。
 */
function setupSupabase(tracking: { trackedUserId: string | null; hasSyncState: boolean }) {
  const fake = createFakeSupabase({
    tables: {
      subscriptions: { data: tracking.trackedUserId ? { user_id: tracking.trackedUserId } : null, error: null },
      subscription_sync_state: {
        data: tracking.hasSyncState ? { stripe_subscription_id: 'sub_test' } : null,
        error: null,
      },
    },
  })

  const ledger = new Set<string>()
  let pendingRequests = 0
  fake.client.rpc.mockImplementation(async (name: string, args?: unknown) => {
    const params = (args ?? {}) as Record<string, unknown>
    switch (name) {
      case 'request_subscription_sync': {
        const eventId = params.p_event_id as string
        if (ledger.has(eventId)) {
          return { data: pendingRequests > 0 ? 'duplicate_pending' : 'duplicate_done', error: null }
        }
        ledger.add(eventId)
        pendingRequests += 1
        return { data: 'requested', error: null }
      }
      case 'acquire_subscription_sync_lease':
        return pendingRequests > 0
          ? { data: [{ result: 'acquired', lease_token: LEASE_TOKEN }], error: null }
          : { data: [{ result: 'up_to_date', lease_token: null }], error: null }
      case 'complete_subscription_sync':
        pendingRequests = 0
        return { data: [{ result: 'applied', needs_resync: false }], error: null }
      default:
        return { data: null, error: null }
    }
  })

  mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
  return fake
}

function stripeReturning(latest: Stripe.Subscription) {
  return { subscriptions: { retrieve: vi.fn().mockResolvedValue(latest) } } as unknown as Stripe & {
    subscriptions: { retrieve: ReturnType<typeof vi.fn> }
  }
}

function run(evt: Stripe.Event, stripe: Stripe) {
  return handleProSubscriptionEvent(evt, stripe, 'sk_test_dummy', 'https://staging-ref.supabase.co', 'service-role-dummy')
}

function completeCalls(fake: ReturnType<typeof setupSupabase>) {
  return fake.client.rpc.mock.calls
    .filter(([name]) => name === 'complete_subscription_sync')
    .map(([, args]) => args as Record<string, unknown>)
}

const ENV_KEYS = ['STRIPE_PRO_PRICE_ID', 'VERCEL_ENV', 'PRO_CHECKOUT_ENABLED'] as const
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

describe('Pro契約の終了（customer.subscription.deleted）', () => {
  it('1. 追跡済みの契約が終了すると、p_status=canceled でDBのユーザーに保存する', async () => {
    const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled' }))

    const outcome = await run(event('customer.subscription.deleted', 'evt_deleted', { status: 'canceled' }), stripe)

    expect(outcome).toEqual({ httpStatus: 200, body: { received: true, result: 'applied' } })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_test')
    expect(completeCalls(fake)).toEqual([
      expect.objectContaining({
        p_stripe_subscription_id: 'sub_test',
        target_user_id: USER_ID,
        p_stripe_customer_id: 'cus_test',
        p_status: 'canceled',
        p_price_id: 'price_pro_test',
        // 終了済みの契約は cancel_at が残っていても「解約予約あり」にしない
        p_cancel_at_period_end: false,
        // 既存追跡の更新であり、新規追跡（Pro付与の開始）ではない
        p_allow_new_tracking: false,
      }),
    ])
  })

  it('1-2. 既存追跡の契約は、Stripe側の metadata が別ユーザーに変わっていてもDBのユーザーで保存する', async () => {
    const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled', metadataUserId: OTHER_USER_ID }))

    await run(event('customer.subscription.deleted', 'evt_deleted', { status: 'canceled' }), stripe)

    expect(completeCalls(fake)).toEqual([expect.objectContaining({ target_user_id: USER_ID, p_status: 'canceled' })])
  })

  it('2. 契約終了後に古い updated（active）が届いても、最新状態を取得して canceled で保存する', async () => {
    const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled' }))

    // イベント本文は契約中（active・解約予約なし）の古い内容
    const staleEvent = event('customer.subscription.updated', 'evt_old_updated', {
      status: 'active',
      cancel_at: null,
      cancel_at_period_end: false,
      metadata: { product: 'pro', supabase_user_id: USER_ID },
    })
    const outcome = await run(staleEvent, stripe)

    expect(outcome.httpStatus).toBe(200)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
    expect(completeCalls(fake)).toEqual([
      expect.objectContaining({ p_status: 'canceled', p_cancel_at_period_end: false }),
    ])
  })

  it('3. 同じ deleted イベントが2回届いた場合、2回目は重複として処理し、再同期しない', async () => {
    const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled' }))
    const deleted = event('customer.subscription.deleted', 'evt_deleted_dup', { status: 'canceled' })

    const first = await run(deleted, stripe)
    const second = await run(deleted, stripe)

    expect(first.body).toEqual({ received: true, result: 'applied' })
    expect(second).toEqual({ httpStatus: 200, body: { received: true, duplicate: true } })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
    expect(completeCalls(fake)).toHaveLength(1)
  })

  it('4. 追跡対象外（metadata も Pro ではない）の deleted は、DBにもStripeにも触れず 200 で無視する', async () => {
    const fake = setupSupabase({ trackedUserId: null, hasSyncState: false })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled' }))

    const outcome = await run(
      event('customer.subscription.deleted', 'evt_unrelated', {
        status: 'canceled',
        metadata: { product: 'something_else' },
      }),
      stripe,
    )

    expect(outcome).toEqual({ httpStatus: 200, body: { received: true, skipped: true } })
    expect(fake.client.rpc).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it('4-2. metadata が無い他システムの Subscription の deleted も無視する', async () => {
    const fake = setupSupabase({ trackedUserId: null, hasSyncState: false })
    const stripe = stripeReturning(stripeSubscription({ status: 'canceled' }))

    const outcome = await run(event('customer.subscription.deleted', 'evt_no_metadata', { status: 'canceled' }), stripe)

    expect(outcome.body).toEqual({ received: true, skipped: true })
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })

  it('6. 契約終了の同期は課金用テーブルとRPCだけを使い、工事案件・写真のテーブルには触れない', async () => {
    const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
    await run(
      event('customer.subscription.deleted', 'evt_deleted_scope', { status: 'canceled' }),
      stripeReturning(stripeSubscription({ status: 'canceled' })),
    )

    const tables = new Set(fake.client.from.mock.calls.map(([table]) => table))
    expect([...tables].sort()).toEqual(['subscription_sync_state', 'subscriptions'])
    for (const [name] of fake.client.rpc.mock.calls) {
      expect(SYNC_RPCS.has(name)).toBe(true)
    }
  })
})

describe('Pro新規購入の停止（PRO_CHECKOUT_ENABLED）の影響を受けない', () => {
  it.each([
    ['未設定', undefined],
    ['false', 'false'],
  ])('PRO_CHECKOUT_ENABLED が%sでも、既存契約の更新（解約予約）・終了は同期される', async (_label, value) => {
    if (value === undefined) delete process.env.PRO_CHECKOUT_ENABLED
    else process.env.PRO_CHECKOUT_ENABLED = value

    for (const [type, id, status] of [
      ['customer.subscription.updated', 'evt_updated_flag', 'active'],
      ['customer.subscription.deleted', 'evt_deleted_flag', 'canceled'],
    ] as const) {
      const fake = setupSupabase({ trackedUserId: USER_ID, hasSyncState: true })
      const stripe = stripeReturning(stripeSubscription({ status }))

      const outcome = await run(event(type, id, { status }), stripe)

      expect(outcome).toEqual({ httpStatus: 200, body: { received: true, result: 'applied' } })
      expect(completeCalls(fake)).toEqual([expect.objectContaining({ target_user_id: USER_ID, p_status: status })])
    }
  })
})
