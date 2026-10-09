import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { requireEnv } from './_lib/requireEnv.js'
import { createSupabaseAdminClient } from './_lib/supabaseAdmin.js'
import { resolveAppOrigin } from './_lib/appOrigin.js'

/**
 * 現場フォト Pro（月額）の契約管理用に Stripe Customer Portal の Session を作成する。
 *
 * - 認証方式は create-pro-checkout-session.ts と同じ（Bearer の Supabase access token を
 *   service_role クライアントの auth.getUser で検証し、対象ユーザーを user.id に固定する）。
 * - クライアントから受け取るのは access token のみ。user_id / customer_id / return_url は
 *   リクエストから一切読まない。
 * - Stripe Customer は billing_customers（migration 0008）から本人の行だけを取得する。
 *   Customer が無い場合は新規作成しない（Portal は既存の契約者のためのもの）。
 * - アプリ経由のSubscriptionが1件も無いユーザー（pro_override の開発者アカウント、
 *   Checkout を途中でやめたユーザー等）には Portal を開かせない。
 * - 解約方法（期間終了時の解約）・支払い方法変更の可否は Stripe Dashboard の Portal 設定で決める。
 *   解約・カード変更の結果は既存の Webhook 同期（_lib/proSubscriptionSync.ts）で DB に反映される。
 */

/** ログ用のエラー要約。Secretやリクエスト内容は含めない。 */
function describeError(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return {
      name: e.name ?? null,
      type: e.type ?? null,
      code: e.code ?? null,
      statusCode: e.statusCode ?? null,
      requestId: e.requestId ?? null,
      message: typeof e.message === 'string' ? e.message : null,
    }
  }
  return { message: String(err) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { values: env, missing } = requireEnv([
    'STRIPE_SECRET_KEY',
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const)

  if (missing.length > 0) {
    console.error('[create-billing-portal-session] missing env vars:', missing)
    res.status(500).json({ error: '契約管理機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  // Production以外（Preview / ローカル）では Stripe test mode の鍵以外を拒否する（Checkout APIと同じ安全柵）。
  if (process.env.VERCEL_ENV !== 'production' && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    console.error('[create-billing-portal-session] non-test Stripe key outside production, refusing')
    res.status(500).json({ error: '契約管理機能が現在利用できません（サーバー設定不整合）' })
    return
  }

  // return_url は許可済みOrigin（Vercelのシステム環境変数）のトップページに固定する。
  const origin = resolveAppOrigin({
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
    vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
  })
  if (!origin) {
    console.error('[create-billing-portal-session] could not resolve app origin', {
      vercelEnv: process.env.VERCEL_ENV,
    })
    res.status(500).json({ error: '契約管理機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  const authHeader = req.headers.authorization
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!accessToken) {
    res.status(401).json({ error: '認証が必要です' })
    return
  }

  // billing_customers / subscriptions の参照は service_role で行い、
  // 対象ユーザーは常に auth.getUser(token) で確定した user.id に固定する。
  const supabaseAdmin = createSupabaseAdminClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken)
  if (userError || !userData?.user) {
    console.error('[create-billing-portal-session] auth.getUser failed', {
      status: userError?.status ?? null,
      code: userError?.code ?? null,
      name: userError?.name ?? null,
    })
    res.status(401).json({ error: '認証に失敗しました' })
    return
  }
  const userId = userData.user.id

  const { data: linkedCustomer, error: linkedCustomerError } = await supabaseAdmin
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (linkedCustomerError) {
    console.error('[create-billing-portal-session] billing_customers fetch failed', {
      userId,
      error: describeError(linkedCustomerError),
    })
    res.status(500).json({ error: '契約情報の取得に失敗しました。しばらくしてから再度お試しください。' })
    return
  }
  if (!linkedCustomer) {
    res.status(404).json({ error: '管理できるProプランの契約が見つかりません' })
    return
  }

  const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .limit(1)

  if (subscriptionsError || !subscriptions) {
    console.error('[create-billing-portal-session] subscriptions fetch failed', {
      userId,
      error: describeError(subscriptionsError),
    })
    res.status(500).json({ error: '契約情報の取得に失敗しました。しばらくしてから再度お試しください。' })
    return
  }
  if (subscriptions.length === 0) {
    res.status(404).json({ error: '管理できるProプランの契約が見つかりません' })
    return
  }

  const customerId = linkedCustomer.stripe_customer_id as string
  const stripe = new Stripe(env.STRIPE_SECRET_KEY)

  try {
    // Checkout API と同じく、Stripe側の所有者情報がDBと一致することを確認してから開く。
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted || customer.metadata?.supabase_user_id !== userId) {
      console.error('[create-billing-portal-session] linked customer is deleted or owner mismatch', {
        userId,
        customerId,
        deleted: !!customer.deleted,
      })
      res.status(409).json({ error: '契約情報を確認できませんでした。お問い合わせください。' })
      return
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    })

    if (!session.url) {
      res.status(500).json({ error: '契約管理ページの準備に失敗しました' })
      return
    }

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[create-billing-portal-session] Stripe error', { userId, error: describeError(err) })
    res.status(500).json({ error: '契約管理ページの準備に失敗しました。しばらくしてから再度お試しください。' })
  }
}
