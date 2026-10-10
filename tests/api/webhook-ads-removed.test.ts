import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest } from '@vercel/node'
import { createFakeSupabase, createResponse } from './fakes'

// 広告削除（買い切り・mode=payment）のWebhookが、Pro同期の変更の影響を受けないことの回帰テスト。

const mocks = vi.hoisted(() => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    checkout: { sessions: { listLineItems: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
  },
  createSupabaseAdminClient: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: function Stripe() {
    return mocks.stripe
  },
}))

vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}))

import handler from '../../api/webhooks/stripe'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_STAGING_WEBHOOK_SECRET',
  'STRIPE_ADS_REMOVED_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_ENV',
] as const
const saved: Record<string, string | undefined> = {}

function webhookRequest(): VercelRequest {
  const body = Buffer.from('{}')
  return {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=dummy' },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  } as unknown as VercelRequest
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  // Preview（staging）は Staging 用の Secret だけで動く（本番用の STRIPE_WEBHOOK_SECRET は設定しない）
  delete process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_STAGING_WEBHOOK_SECRET = 'whsec_staging_dummy'
  process.env.STRIPE_ADS_REMOVED_PRICE_ID = 'price_ads_test'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-dummy'
  process.env.VERCEL_ENV = 'preview'
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  vi.restoreAllMocks()
})

describe('Stripe Webhook：広告削除（買い切り）', () => {
  it('mode=payment の購入完了は grant_ads_removed だけを呼び、Pro同期は動かない', async () => {
    const fake = createFakeSupabase({ rpc: { grant_ads_removed: { data: null, error: null } } })
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    mocks.stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_ads',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_ads',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { product: 'ads_removed', supabase_user_id: USER_ID },
        },
      },
    })
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue({
      data: [{ price: { id: 'price_ads_test' }, quantity: 1 }],
    })

    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ received: true })
    expect(fake.client.rpc).toHaveBeenCalledTimes(1)
    expect(fake.client.rpc).toHaveBeenCalledWith('grant_ads_removed', { target_user_id: USER_ID })
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it('Price が一致しない購入は付与せず 200（従来どおり）', async () => {
    const fake = createFakeSupabase({})
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    mocks.stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_ads_wrong',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_wrong',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { product: 'ads_removed', supabase_user_id: USER_ID },
        },
      },
    })
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue({
      data: [{ price: { id: 'price_other' }, quantity: 1 }],
    })

    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ received: true, skipped: true })
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })
})

// Production以外では test mode の鍵・イベントだけで付与する（Pro分岐と同じ安全柵）。
describe('Stripe Webhook：広告削除の環境分離', () => {
  function adsCompletedEvent(livemode: boolean) {
    return {
      id: 'evt_ads_env',
      type: 'checkout.session.completed',
      livemode,
      data: {
        object: {
          id: 'cs_ads_env',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { product: 'ads_removed', supabase_user_id: USER_ID },
        },
      },
    }
  }

  function setup(livemode: boolean) {
    const fake = createFakeSupabase({ rpc: { grant_ads_removed: { data: null, error: null } } })
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    mocks.stripe.webhooks.constructEvent.mockReturnValue(adsCompletedEvent(livemode))
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue({
      data: [{ price: { id: 'price_ads_test' }, quantity: 1 }],
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return fake
  }

  it('Previewで livemode=true のイベントは付与しない（400）', async () => {
    const fake = setup(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(400)
    expect(mocks.stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled()
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })

  it.each(['sk_live_dummy', 'rk_live_dummy'])('Previewで本番用の鍵（%s）なら付与しない（500）', async (key) => {
    process.env.STRIPE_SECRET_KEY = key
    const fake = setup(false)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled()
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })

  it('VERCEL_ENV 未設定（ローカル等）でも livemode=true は付与しない', async () => {
    delete process.env.VERCEL_ENV
    const fake = setup(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(400)
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })

  it('Productionでは本番用の鍵・livemode=true のイベントで従来どおり付与する', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_prod_dummy'
    const fake = setup(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(fake.client.rpc).toHaveBeenCalledWith('grant_ads_removed', { target_user_id: USER_ID })
  })

  it('同じ購入のイベントが再送されても grant_ads_removed を呼ぶだけ（権限を外す処理は無い）', async () => {
    const fake = setup(false)
    for (let i = 0; i < 2; i++) {
      const { res, result } = createResponse()
      await handler(webhookRequest(), res)
      expect(result.statusCode).toBe(200)
    }
    expect(fake.client.rpc.mock.calls.map(([name]) => name)).toEqual(['grant_ads_removed', 'grant_ads_removed'])
  })

  it('Pro の Subscription イベントは広告削除の判定に入らず、Pro同期へ振り分けられる', async () => {
    const fake = createFakeSupabase({
      tables: {
        subscriptions: { data: null, error: null },
        subscription_sync_state: { data: null, error: null },
      },
    })
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
    mocks.stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_sub_unrelated',
      type: 'customer.subscription.updated',
      livemode: false,
      data: { object: { id: 'sub_unrelated', metadata: {} } },
    })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ received: true, skipped: true })
    expect(mocks.stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled()
    expect(fake.client.rpc).not.toHaveBeenCalledWith('grant_ads_removed', expect.anything())
  })
})
