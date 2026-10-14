import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequest, createResponse } from './fakes'

// 完全無料化：新規購入（広告削除・Pro）の受付終了。
// 受付の定数（api/_lib/purchaseGate.ts）は差し替えず、実物のまま、2つのCheckout APIが
// 認証・DB・Stripe より前に止まることを確認する。実際のStripe・Supabaseには接続しない（すべてモック）。

const mocks = vi.hoisted(() => ({
  stripe: {
    customers: { retrieve: vi.fn(), create: vi.fn() },
    subscriptions: { list: vi.fn() },
    checkout: { sessions: { list: vi.fn(), expire: vi.fn(), create: vi.fn() } },
  },
  stripeConstructor: vi.fn(),
  createClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: function Stripe(key: string) {
    mocks.stripeConstructor(key)
    return mocks.stripe
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}))

import checkoutHandler from '../../api/create-checkout-session'
import proCheckoutHandler from '../../api/create-pro-checkout-session'
import { NEW_PURCHASES_OPEN, PURCHASES_CLOSED_BODY, PURCHASES_CLOSED_STATUS } from '../../api/_lib/purchaseGate'

const ROOT = path.resolve(__dirname, '../..')

const ENV_KEYS = [
  'PRO_CHECKOUT_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_ADS_REMOVED_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

// 環境変数・認証がすべて正しく揃っていても止まることを示すため、購入が成立し得る設定にしておく。
function configureEnvForPurchase() {
  process.env.PRO_CHECKOUT_ENABLED = 'true'
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_ADS_REMOVED_PRICE_ID = 'price_ads_test'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key-dummy'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-dummy'
  process.env.VERCEL_ENV = 'preview'
  process.env.VERCEL_URL = 'genba-abc123.vercel.app'
  process.env.VERCEL_BRANCH_URL = 'genba-git-staging.vercel.app'
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL
}

function expectNothingTouched() {
  expect(mocks.stripeConstructor).not.toHaveBeenCalled()
  expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  expect(mocks.stripe.customers.create).not.toHaveBeenCalled()
  expect(mocks.stripe.subscriptions.list).not.toHaveBeenCalled()
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled()
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

describe('新規購入の受付終了（purchaseGate）', () => {
  it('受付は閉じており、410 と「受付終了」を示す応答が定義されている', () => {
    expect(NEW_PURCHASES_OPEN).toBe(false)
    expect(PURCHASES_CLOSED_STATUS).toBe(410)
    expect(PURCHASES_CLOSED_BODY.code).toBe('purchases_closed')
    expect(PURCHASES_CLOSED_BODY.error).toContain('新規購入の受付は終了しました')
  })
})

describe.each([
  ['広告削除 create-checkout-session', checkoutHandler],
  ['Pro月額 create-pro-checkout-session', proCheckoutHandler],
])('%s', (_label, handler) => {
  it('環境変数・認証が揃っていても 410 を返し、Checkout Session を作らない', async () => {
    configureEnvForPurchase()
    const { res, result } = createResponse()
    await handler(createRequest({ headers: { authorization: 'Bearer token' } }), res)

    expect(result.statusCode).toBe(410)
    expect(result.body).toEqual(PURCHASES_CLOSED_BODY)
    expectNothingTouched()
  })

  it('Authorization ヘッダーが無くても 401 ではなく 410（認証より前に止まる）', async () => {
    configureEnvForPurchase()
    const { res, result } = createResponse()
    await handler(createRequest({}), res)

    expect(result.statusCode).toBe(410)
    expectNothingTouched()
  })

  it('環境変数が未設定でも（設定漏れ・変更があっても）受付終了のまま', async () => {
    for (const key of ENV_KEYS) delete process.env[key]
    const { res, result } = createResponse()
    await handler(createRequest({ headers: { authorization: 'Bearer token' } }), res)

    expect(result.statusCode).toBe(410)
    expectNothingTouched()
  })

  it('Production の本番用の鍵が設定されていても Stripe に接続しない', async () => {
    configureEnvForPurchase()
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_dummy'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'genba-photo-app.vercel.app'
    const { res, result } = createResponse()
    await handler(createRequest({ headers: { authorization: 'Bearer token' } }), res)

    expect(result.statusCode).toBe(410)
    expectNothingTouched()
  })

  it('POST 以外は従来どおり 405', async () => {
    configureEnvForPurchase()
    const { res, result } = createResponse()
    await handler(createRequest({ method: 'GET' }), res)

    expect(result.statusCode).toBe(405)
    expectNothingTouched()
  })
})

// 購入停止の対象は「新規Checkout」だけ。既存のWebhook・契約管理・購入履歴・写真出力APIは変えない。
describe('受付終了の対象外（既存の処理を止めない）', () => {
  const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

  it.each([
    'api/webhooks/stripe.ts',
    'api/_lib/proSubscriptionSync.ts',
    'api/create-billing-portal-session.ts',
    'api/create-genbafoto-job.ts',
  ])('%s は purchaseGate に依存しない（受付終了の影響を受けない）', (file) => {
    expect(read(file)).not.toMatch(/purchaseGate|NEW_PURCHASES_OPEN/)
  })

  it('Webhook は広告削除の確定（grant_ads_removed）と Pro の同期を引き続き処理する', () => {
    const source = read('api/webhooks/stripe.ts')
    expect(source).toContain("rpc('grant_ads_removed'")
    expect(source).toContain('handleProSubscriptionEvent')
  })

  it('購入履歴のDB（grant_ads_removed・ads_removed_purchased_at・subscriptions）の migration を削除していない', () => {
    expect(read('supabase/migrations/0006_grant_ads_removed_rpc.sql')).toContain('grant_ads_removed')
    expect(read('supabase/migrations/0003_profiles_plan_tiers_and_lockdown.sql')).toContain('ads_removed_purchased_at')
    expect(read('supabase/migrations/0008_pro_subscription_foundation.sql')).toContain('public.subscriptions')
  })
})

// 無料化してもセキュリティ・安定運用のための制限は残す。
describe('写真出力API（create-genbafoto-job）の安全制限を維持している', () => {
  const source = readFileSync(path.join(ROOT, 'api/create-genbafoto-job.ts'), 'utf8')

  it('Bearer 認証・本人確認・RLS（利用者のJWT）・所有者不一致の拒否・未同期の拒否が残っている', () => {
    expect(source).toContain("startsWith('Bearer ')")
    expect(source).toContain('auth.getUser(accessToken)')
    expect(source).toContain('Authorization: `Bearer ${accessToken}`')
    expect(source).toMatch(/photoRows\.length !== photoIds\.length[\s\S]*?status\(403\)/)
    expect(source).toMatch(/invalidStoragePath[\s\S]*?status\(409\)/)
  })

  it('写真件数の上限（300件）と署名付きURLの有効期限が残っている', () => {
    expect(source).toContain('const MAX_PHOTO_IDS = 300')
    expect(source).toContain('const SIGNED_URL_TTL_SECONDS = 1800')
  })

  it('プランを参照していない（料金による制限も、無料化のための分岐も無い）', () => {
    expect(source).not.toMatch(/\bplan\b|ads_removed|pro_override/)
  })
})
