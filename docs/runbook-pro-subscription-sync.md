# 運用手順：Pro契約がアプリに反映されない場合

最終更新: 2026-10-10

Stripe で Pro（月額）の決済が成立しているのに、現場フォトの表示が Pro に切り替わらない場合の
確認と復旧の手順。**利用者が支払ったのに無料プランのまま、という状態を見逃さないこと**を目的とする。

---

## 1. 経緯（2026-10-10 本番で発生）

- 本番で Pro を購入 → Stripe の決済は成功
- Webhook（`checkout.session.completed` / `customer.subscription.created`）は 200 だが `{"result":"ignored"}`
- Runtime Logs では `allowNewTracking: true`（Webhook側の確認は通過）
- 原因：Supabase の `stripe_pro_prices` に登録した Price ID が、実際に販売した Price と1文字違っていた
- 復旧：正しい Price ID を登録 → Stripe の契約 metadata に `resync=1` を追加 →
  `customer.subscription.updated` で `result: applied` → アプリで Pro を確認

再発防止として、以下をコードに追加済み。

- 購入API（`api/create-pro-checkout-session.ts`）：`STRIPE_PRO_PRICE_ID` が `stripe_pro_prices` に
  無い場合・照合に失敗した場合は、Stripe Customer / Checkout を作らず 500 を返す（課金前に止める）
- Webhook（`api/_lib/proSubscriptionSync.ts`）：`allowNewTracking: true` なのに `ignored` の場合に error ログを出す

---

## 2. 検知

### Vercel Runtime Logs（Production）

次のいずれかが出ていないかを確認する（level: error で絞り込む）。

| ログ | 意味 |
|---|---|
| `[stripe-webhook:pro] config_error: paid Pro subscription not applied (price not in stripe_pro_prices)` | 決済済みの契約が、DBの許可リストに無い Price のため Pro にならなかった |
| `[create-pro-checkout-session] config_error: STRIPE_PRO_PRICE_ID is not registered in stripe_pro_prices` | 販売しようとした Price がDBに無いため、決済を開始しなかった（課金はされていない） |
| `[create-pro-checkout-session] transient_error: stripe_pro_prices lookup failed` | DB照合に失敗したため、決済を開始しなかった（課金はされていない） |

### Supabase SQL Editor（SELECT のみ・定期確認用）

```sql
-- Pro の新規候補として受け付けたが、subscriptions に記録されなかった契約（正常なら 0 件）
select s.stripe_subscription_id, s.requested_seq, s.synced_seq, s.updated_at
from public.subscription_sync_state s
left join public.subscriptions sub using (stripe_subscription_id)
where sub.stripe_subscription_id is null;

-- 同期要求が未完了のまま残っている契約（正常なら 0 件）
select stripe_subscription_id, requested_seq, synced_seq, updated_at
from public.subscription_sync_state
where requested_seq > synced_seq;
```

---

## 3. 原因の確認（SELECT のみ）

接続先が **本番サーバー（Vercel Production の `VITE_SUPABASE_URL`）と同じ Supabase プロジェクト**であることを
確認してから実行する。`<price_...>` には Stripe 管理画面・Runtime Logs の `priceId` を入れる。

```sql
select price_id,
       length(price_id)                            as len,
       price_id = btrim(price_id)                  as no_outer_space,
       price_id = '<price_...>'                    as exact_match,
       encode(convert_to(price_id, 'UTF8'), 'hex') as hex,
       created_at
from public.stripe_pro_prices;
```

`exact_match = true` の行が無ければ、許可リストの登録ミスが原因。
`exact_match = true` の行があるのに Webhook が `ignored` を返す場合は、本番サーバーが別の
Supabase プロジェクトに接続していないかを Vercel の環境変数で確認する。

---

## 4. 復旧

1. **原因を直す**（SQL Editor・承認を得てから）。登録ミスなら正しい Price ID を登録する。

   ```sql
   insert into public.stripe_pro_prices (price_id) values ('<price_...>');
   ```

   Vercel の `STRIPE_PRO_PRICE_ID` と一字一句同じ値であることを、3. の SQL で再確認する。

2. **再同期のきっかけを作る**：Stripe 管理画面で対象の Subscription を開き、metadata に
   **これまでと違う値**のキーを追加する（例：`resync=2`。前回が `resync=1` なら別の値にする）。
   - `product` と `supabase_user_id` は変更しない
   - 請求内容・金額・期間は変わらない
   - 新しい `customer.subscription.updated` が送られ、Webhook が Stripe から最新の状態を取得して同期する

3. **反映を確認する**
   - Webhook の配信結果が 200 で `{"result":"applied"}`
   - Runtime Logs に `[stripe-webhook:pro] done: synced`（result: applied）
   - SQL（SELECT）で `subscriptions` に該当契約の行があり、`status` が `active`、対象ユーザーの `profiles.plan` が `pro`
   - アプリを再読み込みして Pro 表示・広告非表示になっている

---

## 5. やってはいけないこと

- **Webhook の再送で直そうとしない**：同じ Event ID は処理済み（`stripe_webhook_events`）のため
  `duplicate_done` になり、何も変わらない
- **`profiles.plan` を直接 UPDATE しない**：次の `recompute_plan` で上書きされ、契約状態とずれる
- **`subscriptions` / `subscription_sync_state` を手で書き換えない**：書き込みは 0008 の RPC 経由に限定している
- **利用者に再購入させない**：二重課金になる。上記 4. の手順で既存の契約を反映する

---

## 6. 予防（Price を追加・変更するとき）

- Stripe で Price を作成したら、Vercel の `STRIPE_PRO_PRICE_ID` と `stripe_pro_prices` の両方に
  **コピー＆ペーストで**同じ値を設定し、3. の SQL で `exact_match = true` を確認する
- 設定後、購入ボタンから Stripe の決済画面が開くこと（購入APIの事前照合を通ること）を確認する。
  決済画面が開かず「サーバー設定不整合」となる場合は、Runtime Logs の `config_error` を確認する
