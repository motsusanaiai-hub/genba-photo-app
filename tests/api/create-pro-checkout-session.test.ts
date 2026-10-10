import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, createRequest, createResponse } from './fakes'

// 8. 既存Checkout機能への影響確認（resolveAppOrigin を _lib へ移した後も同じ動作をすること）。

const mocks = vi.hoisted(() => ({
  stripe: {
    customers: { retrieve: vi.fn(), create: vi.fn() },
    subscriptions: { list: vi.fn() },
    checkout: { sessions: { list: vi.fn(), expire: vi.fn(), create: vi.fn() } },
  },
  stripeConstructor: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: function Stripe(key: string) {
    mocks.stripeConstructor(key)
    return mocks.stripe
  },
}))

vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}))

import handler, { isProCheckoutEnabled } from '../../api/create-pro-checkout-session'

const USER_ID = '11111111-1111-4111-8111-111111111111'

const ENV_KEYS = [
  'PRO_CHECKOUT_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRO_PRICE_ID',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

function setupSupabase(tables: Record<string, { data: unknown; error: unknown }> = {}) {
  const fake = createFakeSupabase({
    user: { id: USER_ID, email: 'user@example.com' },
    tables: {
      profiles: { data: { plan: 'free', pro_override: false }, error: null },
      subscriptions: { data: [], error: null },
      billing_customers: { data: null, error: null },
      ...tables,
    },
  })
  mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
  return fake
}

const authorized = () => createRequest({ headers: { authorization: 'Bearer token' } })

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.PRO_CHECKOUT_ENABLED = 'true'
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-dummy'
  process.env.VERCEL_ENV = 'preview'
  process.env.VERCEL_URL = 'genba-abc123.vercel.app'
  process.env.VERCEL_BRANCH_URL = 'genba-git-staging.vercel.app'
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL

  vi.clearAllMocks()
  mocks.stripe.customers.create.mockResolvedValue({ id: 'cus_new' })
  mocks.stripe.checkout.sessions.list.mockResolvedValue({ data: [] })
  mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

describe('create-pro-checkout-session（既存機能の回帰）', () => {
  it('未ログインは401', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(createRequest({}), res)
    expect(result.statusCode).toBe(401)
  })

  it('Previewでliveキーは拒否', async () => {
    setupSupabase()
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(500)
    expect(mocks.stripeConstructor).not.toHaveBeenCalled()
  })

  it('新規ユーザー：Customer作成・紐付け後、Pro PriceでCheckout Sessionを作る（戻り先は正規URL）', async () => {
    const fake = setupSupabase()
    const { res, result } = createResponse()
    await handler(createRequest({ headers: { authorization: 'Bearer token', origin: 'https://evil.example' } }), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test' })
    expect(fake.client.rpc).toHaveBeenCalledWith('link_billing_customer', {
      target_user_id: USER_ID,
      p_stripe_customer_id: 'cus_new',
    })
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_new',
        line_items: [{ price: 'price_pro_test', quantity: 1 }],
        success_url: 'https://genba-git-staging.vercel.app/billing/pro/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://genba-git-staging.vercel.app/',
      }),
    )
  })

  it('継続中のSubscriptionがDBにあれば409（二重申し込み防止）', async () => {
    setupSupabase({ subscriptions: { data: [{ stripe_subscription_id: 'sub_1', status: 'active' }], error: null } })
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(409)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('pro_override のアカウントは409', async () => {
    setupSupabase({ profiles: { data: { plan: 'pro', pro_override: true }, error: null } })
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(409)
  })
})

describe('create-pro-checkout-session：新規購入の受付（PRO_CHECKOUT_ENABLED）', () => {
  it('厳密に "true" のときだけ許可する', () => {
    expect(isProCheckoutEnabled('true')).toBe(true)
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
      expect(isProCheckoutEnabled(value)).toBe(false)
    }
  })

  it('PRO_CHECKOUT_ENABLED=true なら購入APIを利用でき、Checkout Sessionを作る', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(200)
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['未設定', undefined],
    ['false', 'false'],
    ['空文字', ''],
    ['大文字の TRUE', 'TRUE'],
    ['1', '1'],
    ['前後に空白', ' true '],
  ])('%s なら403で、認証・DB・Stripeに一切触れない', async (_label, value) => {
    setupSupabase()
    if (value === undefined) delete process.env.PRO_CHECKOUT_ENABLED
    else process.env.PRO_CHECKOUT_ENABLED = value

    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(403)
    expect(result.body).toEqual({ error: '現在、Proプランの新規お申し込みを受け付けていません。' })
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled()
    expect(mocks.stripeConstructor).not.toHaveBeenCalled()
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled()
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('停止中は、他の設定が不足していても403（購入停止を優先して返す）', async () => {
    delete process.env.PRO_CHECKOUT_ENABLED
    delete process.env.STRIPE_PRO_PRICE_ID
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(403)
  })

  it('POST以外は停止中でも405（従来どおり）', async () => {
    delete process.env.PRO_CHECKOUT_ENABLED
    const { res, result } = createResponse()
    await handler(createRequest({ method: 'GET' }), res)
    expect(result.statusCode).toBe(405)
  })
})

describe('create-pro-checkout-session：Production の戻り先は本番URLに固定', () => {
  it('VERCEL_PROJECT_PRODUCTION_URL 未設定・別ドメインのOriginでも本番URLへ戻す（決済内容は従来どおり）', async () => {
    setupSupabase()
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    const { res, result } = createResponse()
    await handler(createRequest({ headers: { authorization: 'Bearer token', origin: 'https://evil.example' } }), res)

    expect(result.statusCode).toBe(200)
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_pro_test', quantity: 1 }],
        success_url: 'https://genba-photo-app.vercel.app/billing/pro/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://genba-photo-app.vercel.app/',
      }),
    )
  })
})
