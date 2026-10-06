import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { requireEnv } from './_lib/requireEnv.js'
import { createSupabaseAdminClient } from './_lib/supabaseAdmin.js'

/**
 * 現場フォト Pro（月額）用のStripe Checkout Session（mode: subscription）を作成する。
 *
 * 既存の広告削除（買い切り）用 create-checkout-session.ts とは完全に別のAPIとし、
 * 既存フローのコード・環境変数（STRIPE_ADS_REMOVED_PRICE_ID 等）には一切依存しない。
 *
 * - クライアントから受け取るのは Supabase の access token のみ。price / 金額 /
 *   user_id / customer_id 等はリクエストから一切読まない。
 * - Price は必ずサーバー側の STRIPE_PRO_PRICE_ID を使う。
 * - Stripe Customer は1ユーザー1件（billing_customers / link_billing_customer、migration 0008）。
 *   所有関係を確認できない場合はすべて fail closed（Sessionを作成しない）。
 * - Subscription の metadata（product='pro' / supabase_user_id）は、将来のWebhookが
 *   「新規追跡候補」を判定する契約（migration 0008 ヘッダー参照）に合わせて設定する。
 *   DBへのPro反映（Webhook）はこのAPIの責務ではない。
 */

const PRO_PRODUCT = 'pro'

/**
 * これらのstatus以外のSubscriptionが残っている場合は、新しいSubscriptionを作らない。
 * 未知のstatus（Stripe側で将来追加されるもの）も「残っている」扱いにする（安全側）。
 */
const ENDED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])

function isSubscriptionEnded(status: string): boolean {
  return ENDED_SUBSCRIPTION_STATUSES.has(status)
}

/**
 * success_url / cancel_url に使うOriginを決める純粋関数。
 *
 * Origin / Host ヘッダーはクライアントが任意に送れるため、そのままURLに使わない
 * （他人を経由した Stripe Checkout → 任意ドメインへのリダイレクトに悪用され得る）。
 * Vercelのシステム環境変数（スキーム無しのホスト名）を許可リストとし、
 * リクエストのOriginが許可リストに含まれる場合だけそれを使う
 * （ログイン中のブラウザと同じOriginへ戻すため。Supabaseのセッションは
 *   Origin単位でlocalStorageに保存されている）。含まれない場合は環境ごとの正規URLへ戻す。
 * 決められない場合は null（呼び出し側で fail closed）。
 */
export function resolveAppOrigin(input: {
  vercelEnv: string | undefined
  vercelUrl: string | undefined
  vercelBranchUrl: string | undefined
  vercelProductionUrl: string | undefined
  requestOrigin: string | undefined
}): string | null {
  const { vercelEnv, vercelUrl, vercelBranchUrl, vercelProductionUrl, requestOrigin } = input

  let requested: URL | null = null
  if (requestOrigin) {
    try {
      requested = new URL(requestOrigin)
    } catch {
      requested = null
    }
  }

  if (vercelEnv === 'production' || vercelEnv === 'preview') {
    const canonical = vercelEnv === 'production' ? vercelProductionUrl : vercelBranchUrl ?? vercelUrl
    const allowedHosts = [canonical, vercelUrl].filter((host): host is string => !!host)
    if (requested && requested.protocol === 'https:' && allowedHosts.includes(requested.host)) {
      return requested.origin
    }
    return canonical ? `https://${canonical}` : null
  }

  // ローカル開発（vercel dev 等）。localhost / 127.0.0.1 のOriginだけ許可する。
  if (
    requested &&
    (requested.protocol === 'http:' || requested.protocol === 'https:') &&
    (requested.hostname === 'localhost' || requested.hostname === '127.0.0.1')
  ) {
    return requested.origin
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { values: env, missing } = requireEnv([
    'STRIPE_SECRET_KEY',
    'STRIPE_PRO_PRICE_ID',
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const)

  if (missing.length > 0) {
    console.error('[create-pro-checkout-session] missing env vars:', missing)
    res.status(500).json({ error: '決済機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  // Production以外（Preview / ローカル）では Stripe test mode の鍵以外を拒否する
  // （staging 用 Preview に Live 鍵が混ざった場合に実課金させないための安全柵）。
  if (process.env.VERCEL_ENV !== 'production' && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    console.error('[create-pro-checkout-session] non-test Stripe key outside production, refusing')
    res.status(500).json({ error: '決済機能が現在利用できません（サーバー設定不整合）' })
    return
  }

  const origin = resolveAppOrigin({
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
    vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
  })
  if (!origin) {
    console.error('[create-pro-checkout-session] could not resolve app origin', {
      vercelEnv: process.env.VERCEL_ENV,
    })
    res.status(500).json({ error: '決済機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  const authHeader = req.headers.authorization
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!accessToken) {
    res.status(401).json({ error: '認証が必要です' })
    return
  }

  // billing_customers / subscriptions / pro_override の確認と link_billing_customer の実行には
  // service_role が必要なため、このAPIでは本人確認後の参照もすべて service_role で行う。
  // 対象ユーザーは常に auth.getUser(token) で確定した user.id に固定する。
  const supabaseAdmin = createSupabaseAdminClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken)
  if (userError || !userData?.user) {
    res.status(401).json({ error: '認証に失敗しました' })
    return
  }
  const user = userData.user
  const userId = user.id

  // ── 既にProか（Developer Override と Subscription由来を区別して判定する） ──
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('plan, pro_override')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    console.error('[create-pro-checkout-session] profile fetch failed:', profileError)
    res.status(500).json({ error: 'プラン情報の取得に失敗しました' })
    return
  }

  if (profile.pro_override === true) {
    // 開発者・管理者用の恒久Pro。課金する必要が無いためSubscriptionを作らない。
    res.status(409).json({ error: 'このアカウントでは既にProプランが有効です' })
    return
  }

  const { data: dbSubscriptions, error: dbSubscriptionsError } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_subscription_id, status')
    .eq('user_id', userId)

  if (dbSubscriptionsError || !dbSubscriptions) {
    console.error('[create-pro-checkout-session] subscriptions fetch failed:', dbSubscriptionsError)
    res.status(500).json({ error: 'プラン情報の取得に失敗しました' })
    return
  }

  if (dbSubscriptions.some((s: { status: string }) => !isSubscriptionEnded(s.status))) {
    res.status(409).json({ error: '既にProプランのお申し込みがあります' })
    return
  }

  if (profile.plan === 'pro') {
    // override も継続中Subscriptionも無いのに plan='pro'（旧来Proの移行漏れ等）。
    // どの権利によるProか確定できないため、新しいSubscriptionは作らない。
    console.error('[create-pro-checkout-session] plan=pro without override or live subscription', {
      userId,
    })
    res.status(409).json({ error: 'プラン情報を確認できませんでした。お問い合わせください。' })
    return
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY)

  try {
    // ── Stripe Customer（1ユーザー1件。作成または再利用） ──
    const { data: linkedCustomer, error: linkedCustomerError } = await supabaseAdmin
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (linkedCustomerError) {
      console.error('[create-pro-checkout-session] billing_customers fetch failed:', linkedCustomerError)
      res.status(500).json({ error: 'お客様情報の取得に失敗しました' })
      return
    }

    let customerId: string

    if (linkedCustomer) {
      customerId = linkedCustomer.stripe_customer_id as string

      const customer = await stripe.customers.retrieve(customerId)
      if (customer.deleted || customer.metadata?.supabase_user_id !== userId) {
        // Stripe側で削除済み、または所有者情報がDBと一致しない。自動で付け替えない。
        console.error('[create-pro-checkout-session] linked customer is deleted or owner mismatch', {
          userId,
          customerId,
          deleted: !!customer.deleted,
        })
        res.status(409).json({ error: 'お客様情報を確認できませんでした。お問い合わせください。' })
        return
      }

      // Webhook（DB反映）より先に、Stripe上の実際のSubscriptionで二重申し込みを防ぐ。
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      })
      if (subscriptions.has_more || subscriptions.data.some((s) => !isSubscriptionEnded(s.status))) {
        res.status(409).json({ error: '既にProプランのお申し込みがあります' })
        return
      }
    } else {
      const customer = await stripe.customers.create({
        ...(user.email ? { email: user.email } : {}),
        metadata: { supabase_user_id: userId },
      })
      customerId = customer.id

      // 所有関係の保存に失敗した場合は fail closed。作成したCustomerは
      // 付け替え・自動削除をせず、ログに残して調査対象とする。
      const { error: linkError } = await supabaseAdmin.rpc('link_billing_customer', {
        target_user_id: userId,
        p_stripe_customer_id: customerId,
      })
      if (linkError) {
        console.error('[create-pro-checkout-session] link_billing_customer failed, orphan customer', {
          userId,
          customerId,
          error: linkError,
        })
        res.status(500).json({ error: 'お客様情報の登録に失敗しました。しばらくしてから再度お試しください。' })
        return
      }
    }

    // ── 未完了のPro Checkout Sessionを失効させる（同時に開いたままの決済画面を1つに保つ） ──
    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    })
    for (const openSession of openSessions.data) {
      if (openSession.metadata?.product === PRO_PRODUCT) {
        await stripe.checkout.sessions.expire(openSession.id)
      }
    }

    const proMetadata = { product: PRO_PRODUCT, supabase_user_id: userId }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      client_reference_id: userId,
      metadata: proMetadata,
      subscription_data: { metadata: proMetadata },
      success_url: `${origin}/billing/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    })

    if (!session.url) {
      res.status(500).json({ error: 'Checkout URLの生成に失敗しました' })
      return
    }

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[create-pro-checkout-session] Stripe error:', err)
    res.status(500).json({ error: '決済セッションの作成に失敗しました' })
  }
}
