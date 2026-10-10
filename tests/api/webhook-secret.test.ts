import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest } from '@vercel/node'
import { createFakeSupabase, createResponse } from './fakes'

// Stripe Webhook の署名Secretを環境ごとに分離する。
//   Production      … STRIPE_WEBHOOK_SECRET だけを使う（必須）
//   Production以外  … STRIPE_STAGING_WEBHOOK_SECRET だけを使う（必須）。本番用Secretへのフォールバックはしない
// 値はすべてテスト用のダミー。

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

import handler, { resolveWebhookSecret } from '../../api/webhooks/stripe'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROD_SECRET = 'whsec_prod_dummy'
const STAGING_SECRET = 'whsec_staging_dummy'

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

/** 環境とSecretを設定する。undefined の変数は削除する。 */
function setEnv(vercelEnv: 'production' | 'preview', secrets: { prod?: string; staging?: string }) {
  process.env.VERCEL_ENV = vercelEnv
  process.env.STRIPE_SECRET_KEY = vercelEnv === 'production' ? 'sk_live_dummy' : 'sk_test_dummy'
  if (secrets.prod === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else process.env.STRIPE_WEBHOOK_SECRET = secrets.prod
  if (secrets.staging === undefined) delete process.env.STRIPE_STAGING_WEBHOOK_SECRET
  else process.env.STRIPE_STAGING_WEBHOOK_SECRET = secrets.staging
}

/** 広告削除の購入完了イベント（署名検証は constructEvent のモックで成功させる）。 */
function setupAdsEvent(livemode: boolean) {
  const fake = createFakeSupabase({ rpc: { grant_ads_removed: { data: null, error: null } } })
  mocks.createSupabaseAdminClient.mockReturnValue(fake.client)
  mocks.stripe.webhooks.constructEvent.mockReturnValue({
    id: 'evt_ads_secret',
    type: 'checkout.session.completed',
    livemode,
    data: {
      object: {
        id: 'cs_ads_secret',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product: 'ads_removed', supabase_user_id: USER_ID },
      },
    },
  })
  mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue({
    data: [{ price: { id: 'price_ads_test' }, quantity: 1 }],
  })
  return fake
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  process.env.STRIPE_ADS_REMOVED_PRICE_ID = 'price_ads_test'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test'
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-dummy'
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  vi.restoreAllMocks()
})

describe('resolveWebhookSecret（純粋関数）', () => {
  it('Production は STRIPE_WEBHOOK_SECRET を使い、Staging 用は参照しない', () => {
    expect(resolveWebhookSecret({ vercelEnv: 'production', webhookSecret: PROD_SECRET, stagingWebhookSecret: STAGING_SECRET }))
      .toEqual({ secret: PROD_SECRET, source: 'STRIPE_WEBHOOK_SECRET' })
  })

  it('Production で本番用が無ければ、Staging 用があっても null（フォールバックしない）', () => {
    expect(resolveWebhookSecret({ vercelEnv: 'production', webhookSecret: undefined, stagingWebhookSecret: STAGING_SECRET }))
      .toEqual({ secret: null, source: 'STRIPE_WEBHOOK_SECRET' })
  })

  it.each(['preview', 'development', undefined])('Production 以外（%s）は STRIPE_STAGING_WEBHOOK_SECRET を使う', (vercelEnv) => {
    expect(resolveWebhookSecret({ vercelEnv, webhookSecret: PROD_SECRET, stagingWebhookSecret: STAGING_SECRET }))
      .toEqual({ secret: STAGING_SECRET, source: 'STRIPE_STAGING_WEBHOOK_SECRET' })
  })

  it('Production 以外で Staging 用が無ければ、本番用があっても null（フォールバックしない）', () => {
    expect(resolveWebhookSecret({ vercelEnv: 'preview', webhookSecret: PROD_SECRET, stagingWebhookSecret: undefined }))
      .toEqual({ secret: null, source: 'STRIPE_STAGING_WEBHOOK_SECRET' })
  })

  it('空文字は未設定として扱う', () => {
    expect(resolveWebhookSecret({ vercelEnv: 'production', webhookSecret: '', stagingWebhookSecret: undefined }).secret).toBeNull()
    expect(resolveWebhookSecret({ vercelEnv: 'preview', webhookSecret: undefined, stagingWebhookSecret: '' }).secret).toBeNull()
  })
})

describe('Webhook ハンドラ：Production', () => {
  it('本番用 Secret があれば、それで署名検証して正常に処理する', async () => {
    setEnv('production', { prod: PROD_SECRET })
    const fake = setupAdsEvent(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(mocks.stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.anything(), 't=1,v1=dummy', PROD_SECRET)
    expect(fake.client.rpc).toHaveBeenCalledWith('grant_ads_removed', { target_user_id: USER_ID })
  })

  it('Staging 用 Secret が誤って設定されていても、本番用で検証する', async () => {
    setEnv('production', { prod: PROD_SECRET, staging: STAGING_SECRET })
    setupAdsEvent(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(mocks.stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), PROD_SECRET)
  })

  it.each([
    ['どちらも無い', {}],
    ['Staging 用だけある', { staging: STAGING_SECRET }],
  ])('本番用 Secret が無ければ（%s）署名検証せずに500', async (_label, secrets) => {
    setEnv('production', secrets)
    const fake = setupAdsEvent(true)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripe.webhooks.constructEvent).not.toHaveBeenCalled()
    expect(fake.client.rpc).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[stripe-webhook] missing env vars:', ['STRIPE_WEBHOOK_SECRET'])
  })
})

describe('Webhook ハンドラ：Preview（staging）', () => {
  it('Staging 用 Secret があれば、それで署名検証して正常に処理する', async () => {
    setEnv('preview', { staging: STAGING_SECRET })
    const fake = setupAdsEvent(false)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(200)
    expect(mocks.stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.anything(), 't=1,v1=dummy', STAGING_SECRET)
    expect(fake.client.rpc).toHaveBeenCalledWith('grant_ads_removed', { target_user_id: USER_ID })
  })

  it('本番用 Secret が無くても正常に処理する', async () => {
    setEnv('preview', { staging: STAGING_SECRET })
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBeUndefined()
    setupAdsEvent(false)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)
    expect(result.statusCode).toBe(200)
  })

  it('両方あっても Staging 用で検証する', async () => {
    setEnv('preview', { prod: PROD_SECRET, staging: STAGING_SECRET })
    setupAdsEvent(false)
    const { res } = createResponse()
    await handler(webhookRequest(), res)
    expect(mocks.stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), STAGING_SECRET)
  })

  it.each([
    ['どちらも無い', {}],
    ['本番用だけある', { prod: PROD_SECRET }],
  ])('Staging 用 Secret が無ければ（%s）本番用にフォールバックせず500', async (_label, secrets) => {
    setEnv('preview', secrets)
    const fake = setupAdsEvent(false)
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(500)
    expect(mocks.stripe.webhooks.constructEvent).not.toHaveBeenCalled()
    expect(fake.client.rpc).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[stripe-webhook] missing env vars:', ['STRIPE_STAGING_WEBHOOK_SECRET'])
  })

  it('他の必須変数と一緒に足りない場合も、まとめて変数名だけをログに出す（値は出さない）', async () => {
    setEnv('preview', { prod: PROD_SECRET })
    delete process.env.STRIPE_ADS_REMOVED_PRICE_ID
    const { res, result } = createResponse()
    await handler(webhookRequest(), res)

    expect(result.statusCode).toBe(500)
    expect(console.error).toHaveBeenCalledWith('[stripe-webhook] missing env vars:', [
      'STRIPE_ADS_REMOVED_PRICE_ID',
      'STRIPE_STAGING_WEBHOOK_SECRET',
    ])
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(PROD_SECRET)
  })
})
