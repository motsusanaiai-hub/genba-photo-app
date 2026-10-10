import type Stripe from 'stripe'
import { requireEnv } from './requireEnv.js'
import { createSupabaseAdminClient } from './supabaseAdmin.js'
import { isValidUuid } from './isValidUuid.js'

/**
 * 現場フォト Pro（月額Subscription）の Webhook 同期処理。
 *
 * migration 0008 ヘッダーの「STEP4 Webhook実装との契約」に従う：
 *   1. 署名検証済みイベントから Subscription ID を取り出す
 *   2. 追跡判定（Stripe APIは呼ばない）
 *        既存追跡 … subscriptions または subscription_sync_state に行がある
 *        新規候補 … イベント本文の metadata.product = 'pro'
 *        どちらでもない → 無関係なSubscriptionとして 2xx で無視
 *   3. request_subscription_sync → acquire_subscription_sync_lease
 *   4. lease取得「後」に stripe.subscriptions.retrieve（最新状態を正とする）
 *   5. complete_subscription_sync（保存・recompute_plan・lease解放）
 *
 * イベント本文の metadata は「同期を試みるかどうか」の絞り込みにだけ使い、
 * 新規追跡（＝Pro付与の開始）は retrieve した最新状態だけで判定する。
 * DBへの書き込みはすべて 0008 の SECURITY DEFINER RPC 経由で、テーブルは参照のみ。
 *
 * 既存の広告削除（買い切り・mode=payment）とは完全に別の処理で、そちらの判定には関与しない。
 */

const LOG_PREFIX = '[stripe-webhook:pro]'
const PRO_PRODUCT = 'pro'

/** lease が busy のときの待機時間（ms）。要素数がそのまま再試行回数の上限になる。 */
const BUSY_RETRY_WAITS_MS = [300, 700, 1500] as const

/** acquire → retrieve → complete の最大回数（needs_resync / lease_lost による再実行を含む）。 */
const MAX_SYNC_ROUNDS = 3

const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

/** Webhookハンドラへ返す結果。httpStatus をそのままレスポンスに使う。 */
export interface ProSyncOutcome {
  httpStatus: number
  body: Record<string, unknown>
}

/**
 * このイベントを Pro 同期の対象として扱うか（純粋関数）。
 * checkout.session.completed は mode === 'subscription' のときだけ対象とし、
 * mode === 'payment'（広告削除の買い切り）は既存処理に残す。
 */
export function isProSubscriptionEvent(event: Pick<Stripe.Event, 'type' | 'data'>): boolean {
  if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) return true
  if (event.type === 'checkout.session.completed') {
    return (event.data.object as Stripe.Checkout.Session).mode === 'subscription'
  }
  return false
}

/**
 * イベントから Subscription ID と、イベント本文の metadata（新規候補の絞り込み用）を取り出す（純粋関数）。
 * 取り出せない場合は null。
 */
export function extractSubscriptionRef(
  event: Pick<Stripe.Event, 'type' | 'data'>,
): { subscriptionId: string; eventMetadata: Stripe.Metadata | null } | null {
  if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    const subscription = event.data.object as Stripe.Subscription
    const id = typeof subscription.id === 'string' ? subscription.id.trim() : ''
    return id ? { subscriptionId: id, eventMetadata: subscription.metadata ?? null } : null
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode !== 'subscription') return null
    const ref = session.subscription
    const id = (typeof ref === 'string' ? ref : ref?.id ?? '').trim()
    // Pro Checkout API は session.metadata と subscription_data.metadata の両方に同じ値を設定している。
    return id ? { subscriptionId: id, eventMetadata: session.metadata ?? null } : null
  }

  return null
}

/** イベント本文の metadata が Pro の新規候補か（Pro付与の根拠には使わない）。 */
export function isNewProCandidate(metadata: Stripe.Metadata | null): boolean {
  return metadata?.product === PRO_PRODUCT && isValidUuid(metadata?.supabase_user_id)
}

/** retrieve した Subscription から complete_subscription_sync に渡す値を作る（純粋関数）。 */
export interface SubscriptionSnapshot {
  customerId: string | null
  status: string
  /** subscription item がちょうど1件のときだけそのPrice。それ以外は null（Pro付与しない）。 */
  priceId: string | null
  /** item がちょうど1件のときだけそのquantity。 */
  quantity: number | null
  /** dahlia では Subscription 本体ではなく subscription item 側にある。item 1件のときだけ。 */
  currentPeriodEnd: string | null
  /**
   * 期間終了時の解約予約があるか。subscriptions.cancel_at_period_end に保存する。
   * Stripe の cancel_at_period_end だけでなく、flexible billing mode の Customer Portal が使う
   * 「cancel_at = 現在の期間終了」の形も含める（isCancelScheduledAtPeriodEnd 参照）。
   */
  cancelAtPeriodEnd: boolean
  metadataProduct: string | null
  metadataUserId: string | null
}

/** cancel_at による解約予約を「期間終了時の解約」とみなすstatus（0008 の subscription_status_grants_pro と同じ）。 */
const CANCEL_AT_SCHEDULABLE_STATUSES = new Set(['active', 'trialing', 'past_due'])

/**
 * 期間終了時の解約予約があるかを判定する純粋関数。
 *
 * - cancel_at_period_end = true … 従来の期間終了時の解約（Stripeの値をそのまま使う）
 * - cancel_at = 現在の期間終了 … flexible billing mode の Customer Portal は期間終了時の解約を
 *   cancel_at_period_end ではなく cancel_at で表す（cancel_at_period_end は false のまま）
 *
 * 期間途中の任意日付の解約（cancel_at が期間終了と異なる）は対象外として false にする。
 * canceled_at は「最後に解約操作をした時刻」で解約予定日ではないため使わない。
 * 解約予約が取り消されると cancel_at は null に戻り、false になる。
 */
export function isCancelScheduledAtPeriodEnd(input: {
  status: string
  cancelAtPeriodEnd: boolean | null | undefined
  cancelAt: number | null | undefined
  currentPeriodEnd: number | null | undefined
}): boolean {
  if (input.cancelAtPeriodEnd === true) return true
  return (
    CANCEL_AT_SCHEDULABLE_STATUSES.has(input.status) &&
    typeof input.cancelAt === 'number' &&
    typeof input.currentPeriodEnd === 'number' &&
    input.cancelAt === input.currentPeriodEnd
  )
}

export function toSubscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const items = subscription.items?.data ?? []
  const singleItem = items.length === 1 && !subscription.items.has_more ? items[0] : null

  const customer = subscription.customer
  const customerId = typeof customer === 'string' ? customer : customer?.id ?? null

  return {
    customerId,
    status: subscription.status,
    priceId: singleItem?.price?.id ?? null,
    quantity: singleItem?.quantity ?? null,
    currentPeriodEnd:
      typeof singleItem?.current_period_end === 'number'
        ? new Date(singleItem.current_period_end * 1000).toISOString()
        : null,
    cancelAtPeriodEnd: isCancelScheduledAtPeriodEnd({
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: subscription.cancel_at,
      currentPeriodEnd: singleItem?.current_period_end,
    }),
    metadataProduct: subscription.metadata?.product ?? null,
    metadataUserId: subscription.metadata?.supabase_user_id ?? null,
  }
}

/**
 * 最新状態に基づき、新規追跡（Pro付与の開始）を許可してよいか（純粋関数）。
 * 許可しない場合は理由を返す。DB側でも stripe_pro_prices による fail-closed 判定が別にかかる。
 */
export function evaluateNewTracking(
  snapshot: SubscriptionSnapshot,
  proPriceId: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (snapshot.metadataProduct !== PRO_PRODUCT) return { allowed: false, reason: 'metadata_product_mismatch' }
  if (!isValidUuid(snapshot.metadataUserId)) return { allowed: false, reason: 'metadata_user_id_invalid' }
  if (snapshot.priceId === null) return { allowed: false, reason: 'not_single_item' }
  if (snapshot.priceId !== proPriceId) return { allowed: false, reason: 'price_mismatch' }
  if (snapshot.quantity !== 1) return { allowed: false, reason: 'quantity_not_one' }
  return { allowed: true }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** ログ用のエラー要約。message以外の識別子だけを出す（Secretやリクエスト内容は含めない）。 */
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

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>

/**
 * Pro Subscription イベントを処理する。isProSubscriptionEvent(event) が true のときだけ呼ぶこと。
 * 署名検証は呼び出し側（api/webhooks/stripe.ts）で完了している前提。
 */
export async function handleProSubscriptionEvent(
  event: Stripe.Event,
  stripe: Stripe,
  stripeSecretKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<ProSyncOutcome> {
  const ctx: Record<string, unknown> = { eventId: event.id, eventType: event.type }

  // ── 設定・環境の確認（Pro分岐のときだけ。買い切りWebhookには影響させない） ──
  const { values: env, missing } = requireEnv(['STRIPE_PRO_PRICE_ID'] as const)
  if (missing.length > 0) {
    console.error(`${LOG_PREFIX} config_error: missing env vars, Pro sync not executed`, { ...ctx, missing })
    return { httpStatus: 500, body: { error: 'pro sync not configured' } }
  }

  if (process.env.VERCEL_ENV !== 'production') {
    if (!/^(sk|rk)_test_/.test(stripeSecretKey)) {
      console.error(`${LOG_PREFIX} config_error: non-test Stripe key outside production, refusing`, ctx)
      return { httpStatus: 500, body: { error: 'pro sync not configured' } }
    }
    if (event.livemode !== false) {
      console.error(`${LOG_PREFIX} rejected: livemode event outside production, refusing`, ctx)
      return { httpStatus: 400, body: { error: 'livemode event not accepted in this environment' } }
    }
  }

  // ── Subscription ID ──
  const ref = extractSubscriptionRef(event)
  if (!ref) {
    console.warn(`${LOG_PREFIX} skipped: subscription id not found in event`, ctx)
    return { httpStatus: 200, body: { received: true, skipped: true } }
  }
  const { subscriptionId } = ref
  ctx.subscriptionId = subscriptionId

  const supabaseAdmin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey)

  // ── 追跡判定（Stripe APIは呼ばない） ──
  let trackedUserId: string | null
  let hasSyncState: boolean
  try {
    const tracking = await loadTrackingState(supabaseAdmin, subscriptionId)
    trackedUserId = tracking.trackedUserId
    hasSyncState = tracking.hasSyncState
  } catch (err) {
    console.error(`${LOG_PREFIX} transient_error: tracking lookup failed`, { ...ctx, error: describeError(err) })
    return { httpStatus: 500, body: { error: 'tracking lookup failed' } }
  }

  const isTracked = trackedUserId !== null || hasSyncState
  if (!isTracked && !isNewProCandidate(ref.eventMetadata)) {
    console.info(`${LOG_PREFIX} skipped: not a Pro subscription managed by this app`, ctx)
    return { httpStatus: 200, body: { received: true, skipped: true } }
  }
  ctx.tracking = trackedUserId !== null ? 'existing' : hasSyncState ? 'sync_state_only' : 'new_candidate'

  // ── 1. 同期要求の記録（Event IDの二重受付防止を兼ねる） ──
  const { data: requestResult, error: requestError } = await supabaseAdmin.rpc('request_subscription_sync', {
    p_stripe_subscription_id: subscriptionId,
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created: new Date(event.created * 1000).toISOString(),
  })
  if (requestError) {
    console.error(`${LOG_PREFIX} transient_error: request_subscription_sync failed`, {
      ...ctx,
      error: describeError(requestError),
    })
    return { httpStatus: 500, body: { error: 'sync request failed' } }
  }
  if (requestResult === 'duplicate_done') {
    console.info(`${LOG_PREFIX} done: duplicate event already synced`, ctx)
    return { httpStatus: 200, body: { received: true, duplicate: true } }
  }
  ctx.request = requestResult

  // ── 2〜4. lease → retrieve → complete（上限付きで収束させる） ──
  return runSyncLoop(supabaseAdmin, stripe, subscriptionId, trackedUserId, env.STRIPE_PRO_PRICE_ID, ctx)
}

async function loadTrackingState(
  supabaseAdmin: SupabaseAdmin,
  subscriptionId: string,
): Promise<{ trackedUserId: string | null; hasSyncState: boolean }> {
  const [subscriptionRow, syncStateRow] = await Promise.all([
    supabaseAdmin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle(),
    supabaseAdmin
      .from('subscription_sync_state')
      .select('stripe_subscription_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle(),
  ])
  if (subscriptionRow.error) throw subscriptionRow.error
  if (syncStateRow.error) throw syncStateRow.error

  return {
    trackedUserId: (subscriptionRow.data?.user_id as string | undefined) ?? null,
    hasSyncState: syncStateRow.data !== null,
  }
}

async function releaseLease(
  supabaseAdmin: SupabaseAdmin,
  subscriptionId: string,
  leaseToken: string,
  ctx: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('release_subscription_sync_lease', {
    p_stripe_subscription_id: subscriptionId,
    p_lease_token: leaseToken,
  })
  if (error) {
    // 解放に失敗しても lease はDB時計で60秒後に失効し、次の acquire で回収される。
    console.error(`${LOG_PREFIX} release_subscription_sync_lease failed (lease will expire)`, {
      ...ctx,
      error: describeError(error),
    })
  }
}

async function runSyncLoop(
  supabaseAdmin: SupabaseAdmin,
  stripe: Stripe,
  subscriptionId: string,
  trackedUserId: string | null,
  proPriceId: string,
  ctx: Record<string, unknown>,
): Promise<ProSyncOutcome> {
  let busyRetries = 0
  let rounds = 0
  let lastResult: string | null = null

  for (;;) {
    // ── acquire ──
    const { data: acquireData, error: acquireError } = await supabaseAdmin.rpc(
      'acquire_subscription_sync_lease',
      { p_stripe_subscription_id: subscriptionId },
    )
    if (acquireError) {
      console.error(`${LOG_PREFIX} transient_error: acquire_subscription_sync_lease failed`, {
        ...ctx,
        error: describeError(acquireError),
      })
      return { httpStatus: 500, body: { error: 'lease acquire failed' } }
    }
    const acquireRow = (Array.isArray(acquireData) ? acquireData[0] : acquireData) as
      | { result: string; lease_token: string | null }
      | undefined

    if (acquireRow?.result === 'up_to_date') {
      console.info(`${LOG_PREFIX} done: up_to_date`, { ...ctx, result: lastResult ?? 'up_to_date', rounds })
      return { httpStatus: 200, body: { received: true, result: lastResult ?? 'up_to_date' } }
    }

    if (acquireRow?.result === 'busy') {
      if (busyRetries >= BUSY_RETRY_WAITS_MS.length) {
        // lease保持者が収束させる。保持者が異常終了していても Stripe の再送で回復する。
        console.warn(`${LOG_PREFIX} transient_error: lease busy, retry limit reached`, { ...ctx, busyRetries })
        return { httpStatus: 503, body: { error: 'sync busy' } }
      }
      await sleep(BUSY_RETRY_WAITS_MS[busyRetries])
      busyRetries += 1
      continue
    }

    if (acquireRow?.result !== 'acquired' || !acquireRow.lease_token) {
      console.error(`${LOG_PREFIX} transient_error: unexpected acquire result`, {
        ...ctx,
        acquireResult: acquireRow?.result ?? null,
      })
      return { httpStatus: 500, body: { error: 'unexpected lease state' } }
    }

    if (rounds >= MAX_SYNC_ROUNDS) {
      await releaseLease(supabaseAdmin, subscriptionId, acquireRow.lease_token, ctx)
      console.warn(`${LOG_PREFIX} transient_error: sync round limit reached`, { ...ctx, rounds })
      return { httpStatus: 503, body: { error: 'sync did not converge' } }
    }
    rounds += 1
    const leaseToken = acquireRow.lease_token

    // ── retrieve（lease取得「後」に最新状態を取得する） ──
    let subscription: Stripe.Subscription
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId)
    } catch (err) {
      await releaseLease(supabaseAdmin, subscriptionId, leaseToken, ctx)
      console.error(`${LOG_PREFIX} transient_error: stripe.subscriptions.retrieve failed`, {
        ...ctx,
        error: describeError(err),
      })
      return { httpStatus: 500, body: { error: 'subscription retrieve failed' } }
    }

    const snapshot = toSubscriptionSnapshot(subscription)
    const roundCtx = { ...ctx, round: rounds, status: snapshot.status, priceId: snapshot.priceId }

    if (!snapshot.customerId) {
      await releaseLease(supabaseAdmin, subscriptionId, leaseToken, ctx)
      console.error(`${LOG_PREFIX} rejected: subscription has no customer, not syncing`, roundCtx)
      return { httpStatus: 200, body: { received: true, skipped: true } }
    }

    // 既存追跡はDBのユーザーを正とする（metadataが後から変わっても付け替えない）。
    // 新規（subscriptions 未登録）は最新状態の metadata のユーザーを使う。
    const targetUserId = trackedUserId ?? snapshot.metadataUserId
    let allowNewTracking = false
    if (trackedUserId === null) {
      const evaluation = evaluateNewTracking(snapshot, proPriceId)
      if (evaluation.allowed) {
        allowNewTracking = true
      } else {
        // Pro化しない。不正・想定外の状態として一時エラーと区別して残す。
        console.warn(`${LOG_PREFIX} rejected: new tracking not allowed`, { ...roundCtx, reason: evaluation.reason })
      }
    }

    if (!isValidUuid(targetUserId)) {
      // complete_subscription_sync には対象ユーザーが必須。紐付け先が無いため保存できない。
      // 再送しても結果は変わらないため 2xx で終了する（Pro化はしない）。
      await releaseLease(supabaseAdmin, subscriptionId, leaseToken, ctx)
      console.error(`${LOG_PREFIX} rejected: no valid user for subscription, not syncing`, roundCtx)
      return { httpStatus: 200, body: { received: true, skipped: true } }
    }

    // ── complete（保存・recompute_plan・lease解放を1トランザクションで） ──
    const { data: completeData, error: completeError } = await supabaseAdmin.rpc('complete_subscription_sync', {
      p_stripe_subscription_id: subscriptionId,
      p_lease_token: leaseToken,
      target_user_id: targetUserId,
      p_stripe_customer_id: snapshot.customerId,
      p_status: snapshot.status,
      p_price_id: snapshot.priceId,
      p_current_period_end: snapshot.currentPeriodEnd,
      p_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      p_allow_new_tracking: allowNewTracking,
    })
    if (completeError) {
      await releaseLease(supabaseAdmin, subscriptionId, leaseToken, ctx)
      // P0001 = RPC内の raise exception（ユーザー/Customer不一致等の整合性違反）。
      // それ以外はDB・通信の一時的失敗の可能性。どちらもDBは変更されていない。
      const kind = completeError.code === 'P0001' ? 'integrity_error' : 'transient_error'
      console.error(`${LOG_PREFIX} ${kind}: complete_subscription_sync failed`, {
        ...roundCtx,
        error: describeError(completeError),
      })
      return { httpStatus: 500, body: { error: 'sync complete failed' } }
    }

    const completeRow = (Array.isArray(completeData) ? completeData[0] : completeData) as
      | { result: string; needs_resync: boolean }
      | undefined
    lastResult = completeRow?.result ?? null
    console.info(`${LOG_PREFIX} complete_subscription_sync`, {
      ...roundCtx,
      result: lastResult,
      needsResync: completeRow?.needs_resync ?? null,
      allowNewTracking,
    })

    if (allowNewTracking && completeRow?.result === 'ignored') {
      // Webhook側の確認（metadata・Price = STRIPE_PRO_PRICE_ID・quantity）は通ったのに、DB側で追跡を
      // 始めなかった＝ Price が stripe_pro_prices に無い。決済は成立しているのにProが付与されない状態のため、
      // error として残す（応答は従来どおり 200。ignored は同期済み扱いのため再送では回復しない）。
      // 回復手順は docs/runbook-pro-subscription-sync.md。ユーザーID等の個人情報は含めない。
      console.error(
        `${LOG_PREFIX} config_error: paid Pro subscription not applied (price not in stripe_pro_prices)`,
        roundCtx,
      )
    }

    if (completeRow?.result === 'lease_lost' || completeRow?.needs_resync === true) {
      // 同期中に新しい要求が来た／lease が他処理に移った。acquire からやり直して収束させる。
      continue
    }
    if (completeRow?.result !== 'applied' && completeRow?.result !== 'ignored') {
      console.error(`${LOG_PREFIX} transient_error: unexpected complete result`, roundCtx)
      return { httpStatus: 500, body: { error: 'unexpected sync result' } }
    }

    console.info(`${LOG_PREFIX} done: synced`, { ...ctx, result: lastResult, rounds })
    return { httpStatus: 200, body: { received: true, result: lastResult } }
  }
}
