import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_lib/requireEnv.js'
import { resolveAppOrigin } from './_lib/appOrigin.js'

/**
 * 広告削除（買い切り300円）用のStripe Checkout Session（mode: payment）を作成する。
 *
 * - クライアントからは user_id を一切受け取らない。受け取るのは Supabase の
 *   access token のみで、誰の購入かはこのハンドラがサーバー側でJWTを検証して
 *   決定する（クライアントが他人のuser_idを主張して購入させることはできない）。
 * - 現在のplanがfree以外（ads_removed / pro）の場合はSessionを作成せず拒否する
 *   （二重購入防止の一次防御。最終的な整合性はDB側のRPCでも担保する）。
 * - Production以外では Stripe test mode の鍵以外を拒否し、戻り先URLは resolveAppOrigin で
 *   許可済みOriginに限定する（create-pro-checkout-session.ts と同じ安全柵）。
 * - 支払い方法はカードに限定する。コンビニ払い等の後払いでは checkout.session.completed 時点で
 *   payment_status が paid にならず、Webhookが付与しないまま入金だけが完了してしまうため。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { values: env, missing } = requireEnv([
    'STRIPE_SECRET_KEY',
    'STRIPE_ADS_REMOVED_PRICE_ID',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ] as const)

  if (missing.length > 0) {
    console.error('[create-checkout-session] missing env vars:', missing)
    res.status(500).json({ error: '決済機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  // Production以外（Preview / ローカル）では Stripe test mode の鍵以外を拒否する
  // （staging 用 Preview に Live 鍵が混ざった場合に実課金させないための安全柵）。
  if (process.env.VERCEL_ENV !== 'production' && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    console.error('[create-checkout-session] non-test Stripe key outside production, refusing')
    res.status(500).json({ error: '決済機能が現在利用できません（サーバー設定不整合）' })
    return
  }

  // 戻り先は許可済みOrigin（Vercelのシステム環境変数）に限定する。Origin / Host ヘッダーはそのまま使わない。
  const origin = resolveAppOrigin({
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
    vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
  })
  if (!origin) {
    console.error('[create-checkout-session] could not resolve app origin', {
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

  // このクライアントにAuthorizationヘッダーを設定しておくことで、
  // 後続の from('profiles') 呼び出しも「その認証済みユーザーとして」実行され、
  // RLS（auth.uid() = id）が正しく効く。
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
  if (userError || !userData?.user) {
    res.status(401).json({ error: '認証に失敗しました' })
    return
  }
  const userId = userData.user.id

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    console.error('[create-checkout-session] profile fetch failed:', profileError)
    res.status(500).json({ error: 'プラン情報の取得に失敗しました' })
    return
  }

  if (profile.plan !== 'free') {
    res.status(400).json({ error: 'この操作は現在のプランでは行えません' })
    return
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: env.STRIPE_ADS_REMOVED_PRICE_ID, quantity: 1 }],
      metadata: {
        supabase_user_id: userId,
        product: 'ads_removed',
      },
      client_reference_id: userId,
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    })

    if (!session.url) {
      res.status(500).json({ error: 'Checkout URLの生成に失敗しました' })
      return
    }

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[create-checkout-session] Stripe error:', err)
    res.status(500).json({ error: '決済セッションの作成に失敗しました' })
  }
}
