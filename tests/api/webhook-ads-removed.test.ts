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
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy'
  delete process.env.STRIPE_STAGING_WEBHOOK_SECRET
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
