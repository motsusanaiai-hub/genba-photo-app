import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { requireEnv } from '../_lib/requireEnv.js'
import { createSupabaseAdminClient } from '../_lib/supabaseAdmin.js'
import { isValidUuid } from '../_lib/isValidUuid.js'
import { handleProSubscriptionEvent, isProSubscriptionEvent } from '../_lib/proSubscriptionSync.js'

// Stripeの署名検証には生のリクエストボディが必要なため、Vercelの自動bodyパースを無効化する。
export const config = {
  api: {
    bodyParser: false,
  },
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks)
}

/**
 * 実際に決済されたline_itemsが、広告削除商品（STRIPE_ADS_REMOVED_PRICE_ID・
 * quantity 1・単一line item）と一致するかどうかだけを判定する純粋関数。
 * Stripe APIへの実際の問い合わせ（listLineItems呼び出し）とは分離してあり、
 * ここは合成データで単体テストできる。
 *
 * 金額（300円等）はコード側にハードコードせず、Stripe Dashboard上のPrice設定を
 * 正とする。ここではPrice IDが一致するかどうかのみを見る。
 */
export function lineItemsMatchAdsRemoved(
  lineItems: Pick<Stripe.LineItem, 'price' | 'quantity'>[],
  adsRemovedPriceId: string,
): boolean {
  if (lineItems.length !== 1) return false
  const [item] = lineItems
  return item.price?.id === adsRemovedPriceId && item.quantity === 1
}

/**
 * Stripe Webhook受信エンドポイント。
 *
 * 対象イベント：checkout.session.completed のみ（広告削除・買い切り決済用）。
 * ※ Pro月額Subscriptionのイベントは署名検証直後に _lib/proSubscriptionSync.ts へ振り分ける。
 * 「Webhookが来たから何でもads_removedにする」実装は行わず、以下を全て満たした
 * 場合のみ public.grant_ads_removed RPC を呼び出す：
 *   1. stripe-signature の検証に成功している
 *   2. event.type === 'checkout.session.completed'
 *   3. session.mode === 'payment'
 *   4. session.payment_status === 'paid'
 *   5. session.metadata.product === 'ads_removed'
 *   6. session.metadata.supabase_user_id がUUIDとして妥当
 *   7. line_itemsが取得できる
 *   8. 実際に決済されたPrice IDが STRIPE_ADS_REMOVED_PRICE_ID と一致する
 *   9. quantityが1である
 *
 * Price ID検証はCheckout Session作成側（create-checkout-session.ts）と
 * 同じ STRIPE_ADS_REMOVED_PRICE_ID を参照することで、「販売したPrice」と
 * 「権利を付与するPrice」を同一IDに固定する。
 *
 * DBの実更新（plan / ads_removed_purchased_at）はここでは一切行わず、
 * SECURITY DEFINER RPC（grant_ads_removed）に委譲する
 * （業務ロジックをWebhook側に書き散らさないため）。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { values: env, missing } = requireEnv([
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_ADS_REMOVED_PRICE_ID',
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const)

  if (missing.length > 0) {
    console.error('[stripe-webhook] missing env vars:', missing)
    res.status(500).json({ error: 'Webhookが現在利用できません（サーバー設定未完了）' })
    return
  }

  const signature = req.headers['stripe-signature']
  if (!signature || Array.isArray(signature)) {
    res.status(400).json({ error: 'stripe-signature header missing' })
    return
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY)
  const rawBody = await readRawBody(req)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err)
    res.status(400).json({ error: 'signature verification failed' })
    return
  }

  // Pro月額Subscription（customer.subscription.* / mode=subscription の checkout）は
  // 別モジュールで処理する。以降の広告削除（mode=payment）の判定には到達しない。
  if (isProSubscriptionEvent(event)) {
    const outcome = await handleProSubscriptionEvent(
      event,
      stripe,
      env.STRIPE_SECRET_KEY,
      env.VITE_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    )
    res.status(outcome.httpStatus).json(outcome.body)
    return
  }

  if (event.type !== 'checkout.session.completed') {
    // 対象外イベントは受理はするが何もしない（将来Pro等の他イベントを
    // 追加する際もこのハンドラの分岐を汚さないよう、ここでは早期returnのみ）。
    res.status(200).json({ received: true })
    return
  }

  const session = event.data.object as Stripe.Checkout.Session
  const supabaseUserId = session.metadata?.supabase_user_id

  const isValid =
    session.mode === 'payment' &&
    session.payment_status === 'paid' &&
    session.metadata?.product === 'ads_removed' &&
    isValidUuid(supabaseUserId)

  if (!isValid) {
    console.warn('[stripe-webhook] checkout.session.completed did not pass validation, skipping', {
      sessionId: session.id,
      mode: session.mode,
      paymentStatus: session.payment_status,
      product: session.metadata?.product,
    })
    res.status(200).json({ received: true, skipped: true })
    return
  }

  // 実際に決済されたPrice ID / quantity を確認する。ここまでの検証（metadata等）は
  // Checkout Session作成時にサーバー自身が設定した値の再確認に過ぎず、実際に
  // 何がいくつ決済されたかはline_itemsを見るまで確定しない。
  let lineItems: Stripe.LineItem[]
  try {
    const list = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 })
    lineItems = list.data
  } catch (err) {
    // Stripe API側の一時的な障害の可能性があるため、DB更新は行わずエラーを記録した上で
    // 500を返す（Stripeの自動リトライにより後で再配信されることを期待する）。
    console.error('[stripe-webhook] failed to fetch line_items:', session.id, err)
    res.status(500).json({ error: 'failed to verify line items' })
    return
  }

  if (!lineItemsMatchAdsRemoved(lineItems, env.STRIPE_ADS_REMOVED_PRICE_ID)) {
    // Price ID不一致・line item数異常・quantity異常はいずれも「決済内容がads_removedの
    // 想定と一致しない」という決定的な結果であり、リトライしても結果は変わらないため200を返す。
    console.warn('[stripe-webhook] line_items did not match ads_removed price, skipping', {
      sessionId: session.id,
      expectedPriceId: env.STRIPE_ADS_REMOVED_PRICE_ID,
      actual: lineItems.map((item) => ({ priceId: item.price?.id, quantity: item.quantity })),
    })
    res.status(200).json({ received: true, skipped: true })
    return
  }

  const supabaseAdmin = createSupabaseAdminClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await supabaseAdmin.rpc('grant_ads_removed', {
    target_user_id: supabaseUserId,
  })

  if (error) {
    console.error('[stripe-webhook] grant_ads_removed RPC failed:', error)
    res.status(500).json({ error: 'failed to grant ads_removed' })
    return
  }

  res.status(200).json({ received: true })
}
