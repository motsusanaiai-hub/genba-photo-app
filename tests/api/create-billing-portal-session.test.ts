import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, createRequest, createResponse } from './fakes'

const mocks = vi.hoisted(() => ({
  stripe: {
    customers: { retrieve: vi.fn(), create: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
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

import handler from '../../api/create-billing-portal-session'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const ACCESS_TOKEN = 'access-token-of-user'
const SECRET_KEY = 'sk_test_dummy_secret'
const SERVICE_ROLE_KEY = 'service-role-dummy'

const ENV_KEYS = [
  'PRO_CHECKOUT_ENABLED',
  'STRIPE_SECRET_KEY',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

function setupSupabase(overrides: Parameters<typeof createFakeSupabase>[0] = {}) {
  const fake = createFakeSupabase({
    user: { id: USER_ID },
    tables: {
      billing_customers: { data: { stripe_customer_id: 'cus_own' }, error: null },
      subscriptions: { data: [{ stripe_subscription_id: 'sub_own' }], error: null },
    },
    ...overrides,
  })
  mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
  return fake
}

function authorizedRequest(extra: { headers?: Record<string, string>; body?: unknown } = {}) {
  return createRequest({
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, ...extra.headers },
    body: extra.body,
  })
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.STRIPE_SECRET_KEY = SECRET_KEY
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY
  process.env.VERCEL_ENV = 'preview'
  process.env.VERCEL_URL = 'genba-abc123.vercel.app'
  process.env.VERCEL_BRANCH_URL = 'genba-git-staging.vercel.app'
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL

  vi.clearAllMocks()
  mocks.stripe.customers.retrieve.mockResolvedValue({
    id: 'cus_own',
    deleted: undefined,
    metadata: { supabase_user_id: USER_ID },
  })
  mocks.stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test_123' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

describe('create-billing-portal-session', () => {
  it('POST以外は405', async () => {
    setupSupabase()
    const { res, result } = createResponse()
    await handler(createRequest({ method: 'GET' }), res)
    expect(result.statusCode).toBe(405)
  })

  describe('1. 未ログインは拒否', () => {
    it('Authorizationヘッダーが無ければ401で、Stripeを呼ばない', async () => {
      setupSupabase()
      const { res, result } = createResponse()
      await handler(createRequest({}), res)
      expect(result.statusCode).toBe(401)
      expect(mocks.stripeConstructor).not.toHaveBeenCalled()
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })

    it('Bearer以外の形式は401', async () => {
      setupSupabase()
      const { res, result } = createResponse()
      await handler(createRequest({ headers: { authorization: `Basic ${ACCESS_TOKEN}` } }), res)
      expect(result.statusCode).toBe(401)
    })

    it('無効なトークン（auth.getUser失敗）は401で、DBもStripeも参照しない', async () => {
      const fake = setupSupabase({ user: null, userError: { status: 401, code: 'bad_jwt', name: 'AuthApiError' } })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(401)
      expect(fake.client.from).not.toHaveBeenCalled()
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })
  })

  describe('2. 正常なPro契約', () => {
    it('DBのCustomerでPortal Sessionを作り、URLを返す', async () => {
      const fake = setupSupabase()
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)

      expect(result.statusCode).toBe(200)
      expect(result.body).toEqual({ url: 'https://billing.stripe.com/p/session/test_123' })
      expect(fake.client.auth.getUser).toHaveBeenCalledWith(ACCESS_TOKEN)
      expect(mocks.stripe.customers.retrieve).toHaveBeenCalledWith('cus_own')
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_own',
        return_url: 'https://genba-git-staging.vercel.app/',
      })
    })
  })

  describe('3. 他人の契約を指定できない', () => {
    it('リクエストのuser_id / customer_id / return_url は無視し、トークンのユーザーだけで検索する', async () => {
      const fake = setupSupabase()
      const { res, result } = createResponse()
      await handler(
        authorizedRequest({
          body: { user_id: OTHER_USER_ID, customer_id: 'cus_other', return_url: 'https://evil.example/' },
        }),
        res,
      )

      expect(result.statusCode).toBe(200)
      expect(fake.eqCalls).toEqual([
        { table: 'billing_customers', column: 'user_id', value: USER_ID },
        { table: 'subscriptions', column: 'user_id', value: USER_ID },
      ])
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_own',
        return_url: 'https://genba-git-staging.vercel.app/',
      })
    })

    it('Stripe側のCustomer所有者がDBと一致しない場合は409でPortalを開かない', async () => {
      setupSupabase()
      mocks.stripe.customers.retrieve.mockResolvedValue({
        id: 'cus_own',
        metadata: { supabase_user_id: OTHER_USER_ID },
      })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(409)
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })

    it('Stripe側でCustomerが削除済みの場合は409', async () => {
      setupSupabase()
      mocks.stripe.customers.retrieve.mockResolvedValue({ id: 'cus_own', deleted: true })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(409)
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })
  })

  describe('4. 契約が無い場合', () => {
    it('Customerが無ければ404で、Customerを新規作成しない', async () => {
      setupSupabase({
        tables: {
          billing_customers: { data: null, error: null },
          subscriptions: { data: [], error: null },
        },
      })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(404)
      expect(result.body).toEqual({ error: '管理できるProプランの契約が見つかりません' })
      expect(mocks.stripe.customers.create).not.toHaveBeenCalled()
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })

    it('CustomerはあってもSubscriptionが無い（Checkout途中離脱・pro_overrideのみ等）なら404', async () => {
      setupSupabase({
        tables: {
          billing_customers: { data: { stripe_customer_id: 'cus_own' }, error: null },
          subscriptions: { data: [], error: null },
        },
      })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(404)
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })

    it('DBの参照に失敗したら500', async () => {
      setupSupabase({
        tables: { billing_customers: { data: null, error: { code: '42501', message: 'permission denied' } } },
      })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(500)
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })
  })

  describe('5. Stripe APIエラー', () => {
    it('Portal Session作成の失敗は500と日本語メッセージを返し、鍵やトークンをログに出さない', async () => {
      setupSupabase()
      mocks.stripe.billingPortal.sessions.create.mockRejectedValue(
        Object.assign(new Error('No configuration provided'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
          requestId: 'req_123',
        }),
      )
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)

      expect(result.statusCode).toBe(500)
      expect((result.body as { error: string }).error).toMatch(/契約管理ページの準備に失敗しました/)

      const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
      expect(logged).not.toContain(SECRET_KEY)
      expect(logged).not.toContain(ACCESS_TOKEN)
      expect(logged).not.toContain(SERVICE_ROLE_KEY)
      expect(logged).toContain('req_123')
    })

    it('Customer取得の失敗も500', async () => {
      setupSupabase()
      mocks.stripe.customers.retrieve.mockRejectedValue(new Error('network'))
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(500)
    })

    it('Stripeがurlを返さない場合は500', async () => {
      setupSupabase()
      mocks.stripe.billingPortal.sessions.create.mockResolvedValue({ url: null })
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(500)
    })
  })

  describe('6. return_url の安全性', () => {
    it('許可済みのOrigin（このデプロイのURL）なら、そのOriginへ戻す', async () => {
      setupSupabase()
      const { res } = createResponse()
      await handler(authorizedRequest({ headers: { origin: 'https://genba-abc123.vercel.app' } }), res)
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ return_url: 'https://genba-abc123.vercel.app/' }),
      )
    })

    it('許可されていないOriginは無視し、環境の正規URLへ戻す', async () => {
      setupSupabase()
      const { res } = createResponse()
      await handler(authorizedRequest({ headers: { origin: 'https://evil.example' } }), res)
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ return_url: 'https://genba-git-staging.vercel.app/' }),
      )
    })

    it('Originを決められない環境では500でPortalを開かない', async () => {
      setupSupabase()
      delete process.env.VERCEL_ENV
      const { res, result } = createResponse()
      await handler(authorizedRequest({ headers: { origin: 'https://evil.example' } }), res)
      expect(result.statusCode).toBe(500)
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
    })
  })

  describe('7. Production以外ではtest modeの鍵だけ許可', () => {
    it.each(['sk_live_dummy', 'rk_live_dummy'])('Previewで %s は500で拒否し、認証もStripeも行わない', async (key) => {
      const fake = setupSupabase()
      process.env.STRIPE_SECRET_KEY = key
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(500)
      expect(fake.client.auth.getUser).not.toHaveBeenCalled()
      expect(mocks.stripeConstructor).not.toHaveBeenCalled()
    })

    it('rk_test_ の制限付きキーは許可', async () => {
      setupSupabase()
      process.env.STRIPE_SECRET_KEY = 'rk_test_dummy'
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(200)
    })

    it('必須の環境変数が無ければ500', async () => {
      setupSupabase()
      delete process.env.STRIPE_SECRET_KEY
      const { res, result } = createResponse()
      await handler(authorizedRequest(), res)
      expect(result.statusCode).toBe(500)
    })
  })
})

describe('create-billing-portal-session：Pro新規購入の停止（PRO_CHECKOUT_ENABLED）の影響を受けない', () => {
  it.each([
    ['未設定', undefined],
    ['false', 'false'],
  ])('PRO_CHECKOUT_ENABLED が%sでも、既存契約者は契約管理（解約・支払い方法変更）を開ける', async (_label, value) => {
    if (value === undefined) delete process.env.PRO_CHECKOUT_ENABLED
    else process.env.PRO_CHECKOUT_ENABLED = value
    setupSupabase()
    const { res, result } = createResponse()
    await handler(authorizedRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ url: 'https://billing.stripe.com/p/session/test_123' })
  })
})
