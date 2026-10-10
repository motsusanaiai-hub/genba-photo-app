import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, createRequest, createResponse } from './fakes'

// 広告削除（買い切り300円）の Checkout API。
// Pro Checkout と同じ安全柵（Production以外は test 鍵のみ・戻り先は許可済みOriginのみ）と、
// カード決済限定・既存の認可（本人確認・free以外は購入不可）を確認する。

const mocks = vi.hoisted(() => ({
  stripe: {
    checkout: { sessions: { create: vi.fn() } },
  },
  stripeConstructor: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: function Stripe(key: string) {
    mocks.stripeConstructor(key)
    return mocks.stripe
  },
}))

// このAPIは利用者のJWTを付けた anon クライアントで profiles を参照する。
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

import handler from '../../api/create-checkout-session'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const BRANCH_HOST = 'genba-git-staging.vercel.app'
const DEPLOY_HOST = 'genba-abc123.vercel.app'

const ENV_KEYS = [
  'PRO_CHECKOUT_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_ADS_REMOVED_PRICE_ID',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

function setupSupabase(options: { plan?: string; user?: { id: string } | null; userError?: unknown } = {}) {
  const fake = createFakeSupabase({
    user: options.user === undefined ? { id: USER_ID } : options.user,
    userError: options.userError,
    tables: { profiles: { data: { plan: options.plan ?? 'free' }, error: null } },
  })
  mocks.createClient.mockReturnValue(fake.client)
  return fake
}

function authorized(headers: Record<string, string> = {}) {
  return createRequest({ headers: { authorization: 'Bearer token', ...headers } })
}

function createdSession() {
  expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  return mocks.stripe.checkout.sessions.create.mock.calls[0][0]
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_ADS_REMOVED_PRICE_ID = 'price_ads_test'
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key-dummy'
  process.env.VERCEL_ENV = 'preview'
  process.env.VERCEL_URL = DEPLOY_HOST
  process.env.VERCEL_BRANCH_URL = BRANCH_HOST
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL

  vi.clearAllMocks()
  mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_ads' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

describe('create-checkout-session（広告削除）：Stripe 本番・テスト環境の分離', () => {
  it.each(['sk_live_dummy', 'rk_live_dummy'])('Previewで本番用の鍵（%s）なら決済を作らず500', async (key) => {
    setupSupabase()
    process.env.STRIPE_SECRET_KEY = key
    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripeConstructor).not.toHaveBeenCalled()
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('VERCEL_ENV 未設定（ローカル等）でも本番用の鍵は拒否', async () => {
    setupSupabase()
    delete process.env.VERCEL_ENV
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    const { res, result } = createResponse()
    await handler(authorized({ origin: 'http://localhost:5173' }), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('Previewでも制限付きのテスト鍵（rk_test_）は利用できる', async () => {
    setupSupabase()
    process.env.STRIPE_SECRET_KEY = 'rk_test_dummy'
    const { res, result } = createResponse()
    await handler(authorized(), res)
    expect(result.statusCode).toBe(200)
  })

  it('Productionでは本番用の鍵で従来どおり決済を作る', async () => {
    setupSupabase()
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'genba-photo-app.vercel.app'
    const { res, result } = createResponse()
    await handler(authorized({ origin: 'https://genba-photo-app.vercel.app' }), res)

    expect(result.statusCode).toBe(200)
    expect(mocks.stripeConstructor).toHaveBeenCalledWith('sk_live_dummy')
    expect(createdSession().success_url).toBe(
      'https://genba-photo-app.vercel.app/billing/success?session_id={CHECKOUT_SESSION_ID}',
    )
  })
})

describe('create-checkout-session（広告削除）：戻り先URL', () => {
  it('許可されていないOriginは使わず、環境の正規URLへ戻す', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorized({ origin: 'https://evil.example' }), res)

    expect(result.statusCode).toBe(200)
    const params = createdSession()
    expect(params.success_url).toBe(`https://${BRANCH_HOST}/billing/success?session_id={CHECKOUT_SESSION_ID}`)
    expect(params.cancel_url).toBe(`https://${BRANCH_HOST}/`)
    expect(JSON.stringify(params)).not.toContain('evil.example')
  })

  it('Origin が無くても Host ヘッダーから戻り先を作らない', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorized({ host: 'evil.example' }), res)

    expect(result.statusCode).toBe(200)
    expect(JSON.stringify(createdSession())).not.toContain('evil.example')
  })

  it('許可済みのOrigin（同じデプロイのURL）はそのまま使う', async () => {
    setupSupabase()
    const { res } = createResponse()
    await handler(authorized({ origin: `https://${DEPLOY_HOST}` }), res)

    expect(createdSession().success_url).toBe(
      `https://${DEPLOY_HOST}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    )
  })

  it('戻り先を決められない場合は決済を作らず500（fail closed）', async () => {
    setupSupabase()
    delete process.env.VERCEL_ENV
    const { res, result } = createResponse()
    await handler(authorized({ origin: 'https://evil.example' }), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

describe('create-checkout-session（広告削除）：認証・プラン', () => {
  it('Authorization ヘッダーが無ければ401', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(createRequest({}), res)

    expect(result.statusCode).toBe(401)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('トークンを検証できなければ401', async () => {
    setupSupabase({ user: null, userError: { status: 401 } })
    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(401)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it.each(['ads_removed', 'pro'])('plan=%s は購入不可（400）', async (plan) => {
    setupSupabase({ plan })
    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(400)
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('プランはトークンで確定した本人の profiles から読む', async () => {
    const fake = setupSupabase()
    const { res } = createResponse()
    await handler(authorized(), res)
    expect(fake.eqCalls).toEqual([{ table: 'profiles', column: 'id', value: USER_ID }])
  })
})

describe('create-checkout-session（広告削除）：決済内容', () => {
  it('free の正常なテスト決済：カード決済のみ・広告削除Price・本人のIDで Session を作る', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_ads' })
    const params = createdSession()
    expect(params.mode).toBe('payment')
    expect(params.payment_method_types).toEqual(['card'])
    expect(params.line_items).toEqual([{ price: 'price_ads_test', quantity: 1 }])
    expect(params.metadata).toEqual({ supabase_user_id: USER_ID, product: 'ads_removed' })
    expect(params.client_reference_id).toBe(USER_ID)
  })
})

describe('create-checkout-session（広告削除）：Pro新規購入の停止（PRO_CHECKOUT_ENABLED）の影響を受けない', () => {
  it.each([
    ['未設定', undefined],
    ['false', 'false'],
  ])('PRO_CHECKOUT_ENABLED が%sでも従来どおり Session を作る', async (_label, value) => {
    if (value === undefined) delete process.env.PRO_CHECKOUT_ENABLED
    else process.env.PRO_CHECKOUT_ENABLED = value
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorized(), res)

    expect(result.statusCode).toBe(200)
    expect(createdSession().line_items).toEqual([{ price: 'price_ads_test', quantity: 1 }])
  })
})

describe('create-checkout-session（広告削除）：Production の戻り先は本番URLに固定', () => {
  it.each([
    ['VERCEL_PROJECT_PRODUCTION_URL 未設定・別ドメインのOrigin', undefined, 'https://evil.example'],
    ['VERCEL_PROJECT_PRODUCTION_URL が別の値・VERCEL_URL のOrigin', 'genba.example.jp', `https://${DEPLOY_HOST}`],
  ])('%sでも本番URLへ戻す', async (_label, productionUrl, origin) => {
    setupSupabase()
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    if (productionUrl === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = productionUrl
    const { res, result } = createResponse()
    await handler(authorized({ origin, host: 'evil.example' }), res)

    expect(result.statusCode).toBe(200)
    const params = createdSession()
    expect(params.success_url).toBe('https://genba-photo-app.vercel.app/billing/success?session_id={CHECKOUT_SESSION_ID}')
    expect(params.cancel_url).toBe('https://genba-photo-app.vercel.app/')
    expect(params.line_items).toEqual([{ price: 'price_ads_test', quantity: 1 }])
  })
})
