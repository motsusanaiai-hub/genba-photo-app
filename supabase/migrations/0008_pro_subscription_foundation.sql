-- ============================================================================
-- Pro月額Subscription基盤
--   pro_override / stripe_pro_prices / billing_customers / subscriptions /
--   subscription_sync_state / stripe_webhook_events /
--   recompute_plan / request・acquire・complete・release_subscription_sync
-- ============================================================================
-- ⚠️ レビュー用ドラフト（rev.3：STEP3-C再監査の指摘を反映）。本番DBへは未適用。
--    適用はステージングSupabaseでの検証完了後、別途判断する。
--
-- 【適用方法の制限（原子性）】
--   - 原則 `supabase db push` 等、migration単位でトランザクションが保証される方法に限る。
--   - SQL Editorで手動実行する場合は、必ず本文全体を
--       begin;
--       <本ファイル全文>
--       commit;
--     で囲んだ専用手順で一括実行すること。本文だけを貼り付けて実行すると、
--     途中のエラー時に部分適用が残る可能性がある。
--   - supabase/.temp のリンク先が本番プロジェクトのままになっている点に注意。
--     ステージングへ適用する際は接続先（--db-url / project-ref）を必ず確認する。
--
-- 目的：
--   Pro月額Subscriptionを追加しても、以下を壊さない／満たすための基盤を作る。
--     1. 既存の広告削除買い切り（grant_ads_removed）を一切変更しない
--     2. 開発者用の恒久Pro（既存の plan='pro'）をfreeへ落とさない
--     3. Subscription解約・Price変更後に正しいplan（ads_removed / free）へ戻せる
--     4. Stripe Webhookの再送・順不同・同時到着でも最新状態へ収束する
--     5. フロントの既存plan判定（plan列を読むだけ）を変更しない
--
-- 権利の正本と plan の関係：
--   正本A: profiles.pro_override = true            … 開発者・管理者用の恒久Pro
--   正本B: profiles.ads_removed_purchased_at       … 買い切りの恒久広告非表示権
--   正本C: public.subscriptions                    … 期間付きのPro権利
--          （status が Pro付与対象 かつ price_id が stripe_pro_prices に登録済み）
--   profiles.plan は上記から recompute_plan() が計算する「キャッシュ」とする。
--   値の意味（free / ads_removed / pro）は従来と同じ。
--
--   plan の計算順序（recompute_plan）：
--     1. pro_override = true                                     → 'pro'
--     2. status ∈ {active, trialing, past_due}
--        かつ price_id ∈ stripe_pro_prices のSubscriptionがある   → 'pro'
--     3. ads_removed_purchased_at IS NOT NULL                    → 'ads_removed'
--     4. それ以外                                                 → 'free'
--
-- ────────────────────────────────────────────────────────────────────────────
-- 【同期モデル：時刻比較ではなく「直列化＋最新取得＋収束」】
--   Stripe Subscription には新旧比較に使える単調増加のversionが確認できないため、
--   スナップショット同士の新旧を時刻で比較しない（アプリサーバー時計もDB到着順も
--   Stripe上の取得順と一致しない）。代わりに Subscription 単位で次を保証する：
--
--   (1) 同期要求の記録：request_subscription_sync()
--       Webhook受信のたびに subscription_sync_state.requested_seq を +1 する（DBで採番）。
--   (2) 直列化：acquire_subscription_sync_lease()
--       未同期の要求（requested_seq > synced_seq）があり、他の処理がleaseを持って
--       いない場合だけ、短時間のlease（token）を発行する。leaseは同時に1つだけ。
--       発行時点の requested_seq を lease_seq として記録する。
--   (3) 最新取得：Webhookは lease を取得した「後」に Stripe API から Subscription を取得する。
--       lease_seq までの要求はすべて取得より前に記録されているため、取得結果は
--       それらの要求の原因となった変更をすべて反映している。
--   (4) 保存：complete_subscription_sync()
--       lease token が一致する場合だけ保存し、synced_seq = lease_seq とし、
--       recompute_plan() を同一トランザクションで実行してleaseを解放する。
--       token が一致しない（lease期限切れ後に別処理が取得した）場合は保存しない。
--   (5) 収束：保存時点で requested_seq > synced_seq（同期中に新しい要求が来た）なら
--       needs_resync = true を返し、Webhookは (2) からやり直す。
--
--   DBトランザクションは (1)(2)(4) の各RPC内だけで完結し、Stripe HTTP API の待機中に
--   トランザクションやロックを保持しない。lease の期限判定はDB時計（now()）のみを使う。
--
-- 【Event ledger との役割分担】
--   stripe_webhook_events … 同じ Stripe Event ID の二重受付防止（順序保証ではない）
--   subscription_sync_state … Subscription単位の直列化と最新状態への収束（順序の問題を担当）
--
-- 【STEP4 Webhook実装との契約（このDB設計の前提）】
--   対象イベント：customer.subscription.*、invoice.*（subscriptionを持つもの）、
--                 checkout.session.completed（mode=subscription）。
--   既存の広告削除（mode=payment）分岐とは完全に別の分岐として追加し、既存分岐は変更しない。
--     1. stripe-signature 検証、Subscription ID の抽出
--     2. 追跡判定（ここではStripe APIを呼ばない）：
--          既存追跡 … subscriptions または subscription_sync_state に行がある
--                      → Price に関係なく必ず同期を要求する（Pro→非Pro変更を skip しない）
--          新規候補 … イベント本文の subscription metadata.product = 'pro'
--                      （Pro Checkout API が subscription_data.metadata に設定する）
--          どちらでもない → Stripeアカウント内の無関係なSubscriptionとして200で無視
--     3. request_subscription_sync(sub_id, event.id, event.type, event.created)
--          'duplicate_done' → 200（処理済み）
--     4. acquire_subscription_sync_lease(sub_id)   ※ lease時間はDB側で60秒固定
--          'up_to_date' → 200
--          'busy'       → 上限付きの短時間再試行を行い、それでも busy の場合のみ 503 を返す
--                         （再試行回数・待機時間はSTEP4実装時に決める。DBには持たない）。
--                         busy継続はログに残して監視する。
--                         lease保持者が収束させる。保持者が異常終了しても、
--                         Stripe再送 → 'duplicate_pending' → 再取得で回復する
--                         （Stripe再送を回復経路として利用する）
--          'acquired'   → 5へ
--     5. lease取得「後」に stripe.subscriptions.retrieve(sub_id)
--          失敗 → release_subscription_sync_lease() して 500（Stripeが再送）
--          complete が例外になった場合も release_subscription_sync_lease() を呼んでから 500
--     6. complete_subscription_sync(...)
--          user_id：既存追跡ならDBの値、新規なら subscription metadata.supabase_user_id
--          price_id：subscription item が1件ならそのPrice、それ以外は NULL（Pro付与しない）
--          p_allow_new_tracking：新規候補で、取得した最新状態の metadata.product = 'pro'
--                                かつ Price が STRIPE_PRO_PRICE_ID と一致する場合のみ true
--          needs_resync = true → 4 へ（回数上限あり。上限超過時は 503）
--     Webhook側の Price 照合は「新規追跡を受け付けるか」の判定にのみ使い、
--     既存追跡Subscriptionの同期を止める条件には使わない。
--     'duplicate_done' は即 200 を返す。
--
-- 【書き込み経路の集約】
--   subscriptions / subscription_sync_state / stripe_webhook_events / billing_customers は、
--   service_role を含むAPIロールから直接 INSERT / UPDATE / DELETE / TRUNCATE できない。
--   書き込みは下記の SECURITY DEFINER RPC 経由に限定する（service_role は SELECT と EXECUTE のみ）：
--     link_billing_customer / request_subscription_sync / acquire_subscription_sync_lease /
--     release_subscription_sync_lease / complete_subscription_sync / recompute_plan
--   stripe_pro_prices は管理用の許可リストのため、SQL Editor（postgres権限）による
--   管理者操作でのみ登録・削除する（下記runbook）。Webhook・APIからは変更しない。
--
-- 【リリース必須手順（STEP4有効化の前に完了させる）】
--   R0. （R1の前）開発者アカウントのUUIDを確認・記録しておく
--         select id, created_at from public.profiles where plan = 'pro';
--       → Dashboard の Authentication 画面で本人のアカウントと照合し、UUIDを記録する
--   R1. 0008 を適用する
--   R2. R1の直後に、R0で記録したUUIDに pro_override を設定し、recompute_plan で 'pro' を
--       確認する。UPDATE と recompute_plan は同一トランザクションで実行する
--       （下記「開発者Proの移行」）
--   R3. 次のSELECTが 0 であることを確認する（旧来Proが残っていないこと）
--         select count(*) from public.profiles where plan = 'pro' and not pro_override;
--       0 でなければ R4 / R5 へ進まない（原因を確認してから R2 をやり直す）
--   R4. stripe_pro_prices に当該環境のPro Priceを登録する（下記runbook）
--   R5. その後に STEP4（Pro Checkout / Webhook分岐）を有効化する
--
-- 【ステージング適用時の最初の確認項目】
--   - gen_random_uuid() が利用可能であること：  select gen_random_uuid();
--   - 0008 適用後、service_role に subscriptions 等への直接 INSERT/UPDATE/DELETE 権限が
--     無いこと、各RPCの EXECUTE 権限があることを has_table_privilege /
--     has_function_privilege で確認する
--   ※ R2 完了前に開発者アカウントへ recompute_plan が実行されると、override 未設定のため
--     計算結果（free 等）へ変わる。その場合も R2 の手順で pro_override を設定すれば復旧する。
--     recompute_plan 自体には移行期間用の保護ロジックを恒久的に残さない。
--
-- 【開発者Proの移行（本migrationでは自動設定しない）】
--   「唯一の plan='pro' だから開発者」という推測で恒久overrideを付与しない。
--   本migrationは pro_override を全行 false で追加するだけとし、plan は変更しない。
--   適用直後（R2）に、次の明示的な管理者作業で移行する（SQL Editor・postgres権限）：
--     -- (1) 対象はR0（適用前）で確認・記録したUUIDを使う
--     -- (2) 記録したUUIDだけを明示指定して移行（期待：UPDATE 1、recompute結果 'pro'）
--     --     UPDATE と recompute_plan は必ず同一トランザクションで実行する
--     begin;
--     update public.profiles set pro_override = true
--       where id = '<確認済みの開発者UUID>' and plan = 'pro';
--     select public.recompute_plan('<確認済みの開発者UUID>');
--     commit;
--
-- 【Pro対象Priceの登録runbook（本migrationでは登録しない）】
--   stripe_pro_prices は「Pro権利を付与するPrice」の許可リスト（保存可否の制限ではない）。
--   Price ID は秘密情報ではない。Stripe秘密鍵・Webhook Secret等はDBへ保存しない。
--     staging    : Stripe test mode の Price のみ登録する
--     production : Stripe live mode の Price のみ登録する（test Priceを混ぜない）
--   登録前の確認項目（Stripe Dashboard・Vercel設定で目視確認）：
--     [ ] 登録先のSupabaseプロジェクト（staging / production）が正しい
--     [ ] Stripe の test / live モードが登録先環境と一致している
--     [ ] Price ID（price_...）
--     [ ] Product が Pro プランのもの
--     [ ] type = recurring、interval = month（interval_count = 1）
--     [ ] 金額 = 300、通貨 = jpy
--     [ ] 同じ環境の Vercel 環境変数 STRIPE_PRO_PRICE_ID と完全一致
--   登録SQL（SQL Editor・postgres権限）：
--     insert into public.stripe_pro_prices (price_id) values ('<price_...>');
--   未登録のうちは Subscription由来のProは一切付与されない（fail-closed）。
--
-- 【past_due と Pro維持に関するリリース必須条件（STEP4以降）】
--   past_due中はProを維持する（Stripeの再試行期間中にProを即時剥奪しない）。
--   DB側に固定の猶予日数は持たないため、以下を本番リリースの必須条件とする：
--     (1) Stripe Billing の「すべての再試行が失敗した場合」の設定を
--         「サブスクリプションをキャンセル」または「未払いとしてマーク」にする
--     (2) Webhook配信失敗の監視（Stripe Dashboardの失敗通知・Vercelログ）
--     (3) 定期reconciliation：Stripe上のSubscriptionとDBを照合し、差分や
--         未同期（requested_seq > synced_seq）があれば request（p_event_id = NULL）→
--         acquire → retrieve → complete の同じ経路で収束させる
--     (4) 長期 past_due の検出・通知：status = 'past_due' のまま
--         status_changed_at から一定期間を超えたSubscriptionを定期的に抽出して通知する
--         （閾値は監視側の設定とし、DBには持たない）
--
-- 運用ルール（本migration適用後）：
--   - plan列を直接UPDATEしないこと。次のrecompute_planで上書きされる。
--
-- 既存データへの影響（2026-10時点の本番実測: free 9 / ads_removed 2 / pro 1）：
--   plan列・ads_removed_purchased_at列の値は本migrationでは一切書き換えない。
--   pro_override は全行 false で追加される。最後に「旧来Pro以外の全行で
--   plan = 計算結果」であることを検証し、一致しなければ migration 全体を中断する。
--
-- 前提：0001〜0007 が適用済みであること。PostgreSQL 13以上（gen_random_uuid）。
-- ============================================================================


-- ─── 0. 事前チェック ────────────────────────────────────────────────────
-- 0-1. ads_removed なのに購入日時が無い行があると、recompute_plan で free に
--      落ちてしまうため中断する（本番実測では0件）。
do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from public.profiles
  where plan = 'ads_removed' and ads_removed_purchased_at is null;
  if v_bad_count > 0 then
    raise exception
      '0008: plan=''ads_removed'' かつ ads_removed_purchased_at IS NULL の行が % 件あります。'
      '先に整合性を確認してください。', v_bad_count;
  end if;
end
$$;

-- 0-2. profiles の INSERT / DELETE / TRUNCATE を anon / authenticated から剥奪しても
--      新規登録時のprofile自動作成（on_auth_user_created → handle_new_user）が
--      壊れないことを確認する。
--      handle_new_user が SECURITY DEFINER であり、その所有者が profiles への
--      INSERT 権限を持っていれば、トリガーは所有者権限で INSERT するため
--      anon / authenticated の権限には依存しない。
do $$
declare
  v_fn_oid   oid := to_regprocedure('public.handle_new_user()');
  v_secdef   boolean;
  v_owner    name;
begin
  if v_fn_oid is null then
    raise exception '0008: public.handle_new_user() が見つかりません。';
  end if;

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_secdef, v_owner
  from pg_proc p where p.oid = v_fn_oid;

  if not v_secdef then
    raise exception '0008: handle_new_user が SECURITY DEFINER ではないため、REVOKE を中断します。';
  end if;

  if v_owner in ('anon', 'authenticated') then
    raise exception '0008: handle_new_user の所有者が % のため、REVOKE を中断します。', v_owner;
  end if;

  if not has_table_privilege(v_owner, 'public.profiles', 'INSERT') then
    raise exception '0008: handle_new_user の所有者 % に profiles への INSERT 権限がありません。', v_owner;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and tgfoid = v_fn_oid
  ) then
    raise exception '0008: auth.users の on_auth_user_created が handle_new_user を呼んでいません。';
  end if;

  -- ON DELETE CASCADE（auth.users削除 → profiles削除）は参照側テーブル（profiles）の
  -- 所有者権限で実行されるため、anon / authenticated の DELETE 権限には依存しない。
  -- 念のため profiles の所有者が anon / authenticated でないことだけ確認する。
  if pg_get_userbyid((select relowner from pg_class where oid = 'public.profiles'::regclass))
       in ('anon', 'authenticated') then
    raise exception '0008: profiles の所有者が想定外のため、REVOKE を中断します。';
  end if;
end
$$;


-- ─── 1. profiles.pro_override ───────────────────────────────────────────
-- 全行 false で追加するのみ。既存 plan='pro' の自動移行は行わない（ヘッダー参照）。
alter table public.profiles
  add column if not exists pro_override boolean not null default false;

-- pro_override はクライアントから変更させない。
-- 0003 でテーブル単位のUPDATE権限は剥奪済み・列単位GRANTは display_name のみのため、
-- 新規列には UPDATE 権限が付与されない。以下は意図の明示（単独では効果を持たない）。
revoke update (pro_override) on public.profiles from anon, authenticated;


-- ─── 2. profiles の権限強化（防御の追加層） ───────────────────────────────
-- 現状も INSERT / DELETE ポリシーが無いため RLS で拒否されているが、
-- 将来 FOR ALL ポリシー追加・RLS無効化等の誤操作があっても plan 等を
-- INSERT されないよう、GRANT 側でも塞ぐ。TRUNCATE は RLS の対象外のため特に塞ぐ。
-- 安全性は 0-2 で確認済み。
revoke insert, delete, truncate on public.profiles from anon, authenticated;


-- ─── 3. stripe_pro_prices（Pro権利を付与するPriceの許可リスト） ──────────
-- 「保存してよいPrice」ではなく「Pro権利を付与するPrice」の正本。
-- subscriptions には任意の Price を保存でき、Pro判定（recompute_plan）でのみ参照する。
-- 登録手順はヘッダーの runbook 参照。
create table if not exists public.stripe_pro_prices (
  price_id   text        not null,
  created_at timestamptz not null default now(),
  constraint stripe_pro_prices_pkey primary key (price_id),
  constraint stripe_pro_prices_price_id_not_blank check (length(btrim(price_id)) > 0)
);

alter table public.stripe_pro_prices enable row level security;
-- ポリシーは作らない（anon / authenticated からは一切参照・変更させない）。

-- 登録・削除は SQL Editor（postgres＝テーブル所有者）による管理者操作のみ。
-- Webhook・API（service_role）からは参照のみとし、変更させない。
revoke all on table public.stripe_pro_prices from public, anon, authenticated, service_role;
grant select on table public.stripe_pro_prices to service_role;


-- ─── 4. billing_customers（Supabaseユーザー ⇔ Stripe Customer） ──────────
-- 1ユーザー1Customer。書き込みは service_role / SECURITY DEFINER 関数のみ。
-- user_id の FK は ON DELETE RESTRICT：課金記録を持つユーザーを、
-- Stripe側の解約処理なしに auth.users から削除できないようにするため
-- （退会処理を実装する際は Stripe解約 → 本テーブル整理 → ユーザー削除 の順にする）。
-- (user_id, stripe_customer_id) の複合UNIQUEは、subscriptions からの複合FKの参照先。
create table if not exists public.billing_customers (
  user_id            uuid        not null,
  stripe_customer_id text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint billing_customers_pkey primary key (user_id),
  constraint billing_customers_stripe_customer_id_key unique (stripe_customer_id),
  constraint billing_customers_user_customer_key unique (user_id, stripe_customer_id),
  constraint billing_customers_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete restrict,
  constraint billing_customers_stripe_customer_id_not_blank
    check (length(btrim(stripe_customer_id)) > 0)
);

alter table public.billing_customers enable row level security;

drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own"
  on public.billing_customers
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Supabaseのpublicスキーマ既定権限（新規テーブルに anon/authenticated/service_role へ ALL）を
-- 打ち消す。書き込みは link_billing_customer()（SECURITY DEFINER）経由に限定し、
-- service_role には SELECT のみ残す。
revoke all on table public.billing_customers from public, anon, authenticated, service_role;
grant select on table public.billing_customers to authenticated;
grant select on table public.billing_customers to service_role;


-- ─── 5. subscriptions（追跡中Subscriptionの最新状態） ────────────────────
-- - Stripe API から取得した現在の状態をそのまま保存する（時刻比較による新旧判定はしない）。
-- - status は Stripe の値をそのまま保存する（CHECKで値を固定しない）。
-- - price_id は現在の実際の Price（Pro Price以外も保存できる）。
--   subscription item が1件でない等、単一Priceを特定できない場合は NULL（Pro付与しない）。
-- - (user_id, stripe_customer_id) の複合FKにより、Subscriptionのユーザーと
--   Customerの所有ユーザーが一致することをDB制約で保証する。
-- - current_period_end は nullable（Stripe API の新しいバージョンでは
--   subscription item 側にあるため。表示・監査用で plan 計算には使わない）。
-- - status_changed_at：status が変わった時刻（DB時計）。長期 past_due 監視用。
-- - last_synced_at：最後に同期を保存した時刻（DB時計・監査用。順序判定には使わない）。
create table if not exists public.subscriptions (
  stripe_subscription_id text        not null,
  user_id                uuid        not null,
  stripe_customer_id     text        not null,
  status                 text        not null,
  price_id               text        null,
  current_period_end     timestamptz null,
  cancel_at_period_end   boolean     not null default false,
  status_changed_at      timestamptz not null default now(),
  last_synced_at         timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint subscriptions_pkey primary key (stripe_subscription_id),
  constraint subscriptions_user_customer_fkey foreign key (user_id, stripe_customer_id)
    references public.billing_customers (user_id, stripe_customer_id) on delete restrict,
  constraint subscriptions_stripe_subscription_id_not_blank
    check (length(btrim(stripe_subscription_id)) > 0),
  constraint subscriptions_status_not_blank check (length(btrim(status)) > 0)
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 書き込みは complete_subscription_sync()（SECURITY DEFINER）経由に限定し、
-- service_role には SELECT のみ残す（lease / seq を迂回した直接更新を防ぐ）。
revoke all on table public.subscriptions from public, anon, authenticated, service_role;
grant select on table public.subscriptions to authenticated;
grant select on table public.subscriptions to service_role;


-- ─── 6. subscription_sync_state（Subscription単位の同期直列化） ──────────
-- requested_seq：同期要求の通番（DBで採番。Webhook受信・reconciliationのたびに +1）
-- synced_seq   ：保存済みの同期がカバーしている要求の通番
-- lease_token / lease_seq / lease_expires_at：同期処理の排他（同時に1つだけ）
--   lease_seq は lease 発行時点の requested_seq。
--   lease_expires_at はDB時計のみで判定する（異常終了した処理のleaseを回収するため）。
-- requested_seq > synced_seq の行は「未同期の要求あり」。
-- subscriptions に行が無い（まだ追跡していない新規候補）段階でも行を持つ。
-- complete_subscription_sync() が 'ignored'（追跡対象外）と判定した Subscription の行も
-- 削除せず保持する。これは意図した仕様である：
--   - 行が残っていても、Pro権利は subscriptions と stripe_pro_prices でのみ判定されるため
--     誤付与は起きない（fail-closed）
--   - 将来そのSubscriptionが新規追跡条件を満たした場合に同期候補として扱える
--   - 追跡状態を表す列を増やさず、状態管理を単純に保つ
create table if not exists public.subscription_sync_state (
  stripe_subscription_id text        not null,
  requested_seq          bigint      not null default 0,
  synced_seq             bigint      not null default 0,
  lease_token            uuid        null,
  lease_seq              bigint      null,
  lease_expires_at       timestamptz null,
  updated_at             timestamptz not null default now(),
  constraint subscription_sync_state_pkey primary key (stripe_subscription_id),
  constraint subscription_sync_state_id_not_blank
    check (length(btrim(stripe_subscription_id)) > 0),
  constraint subscription_sync_state_seq_order check (synced_seq <= requested_seq),
  constraint subscription_sync_state_lease_consistent check (
    (lease_token is null and lease_seq is null and lease_expires_at is null)
    or (lease_token is not null and lease_seq is not null and lease_expires_at is not null)
  )
);

alter table public.subscription_sync_state enable row level security;
-- ポリシーは作らない（anon / authenticated からは一切参照・変更させない）。

-- 書き込みは request / acquire / release / complete の各RPC（SECURITY DEFINER）経由に限定する。
revoke all on table public.subscription_sync_state from public, anon, authenticated, service_role;
grant select on table public.subscription_sync_state to service_role;


-- ─── 7. stripe_webhook_events（受付済みStripe Eventの台帳） ──────────────
-- 同じ Stripe Event ID の二重受付を防ぐためだけの台帳（順序保証は担わない）。
-- request_subscription_sync() で、同期要求の記録（requested_seq +1）と同一
-- トランザクションで INSERT する。
-- 受付後に同期が失敗しても、未同期の要求（requested_seq > synced_seq）は残るため、
-- Stripeの再送（'duplicate_pending'）やreconciliationで必ず同期が再実行される
-- （＝受付済みEventが「処理済み」として失われることはない）。
-- 保持方針：原則として削除しない（削除すると同じEvent IDの再受付を防げなくなる）。
-- 将来アーカイブする場合は、Event IDの重複防止情報を失わない設計を別途行うこと。
create table if not exists public.stripe_webhook_events (
  event_id               text        not null,
  event_type             text        not null,
  event_created_at       timestamptz not null,
  stripe_subscription_id text        null,
  received_at            timestamptz not null default now(),
  constraint stripe_webhook_events_pkey primary key (event_id),
  constraint stripe_webhook_events_event_id_not_blank check (length(btrim(event_id)) > 0)
);

alter table public.stripe_webhook_events enable row level security;
-- ポリシーは作らない（anon / authenticated からは一切参照・変更させない）。

-- 書き込みは request_subscription_sync()（SECURITY DEFINER）経由に限定する。
revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role;
grant select on table public.stripe_webhook_events to service_role;


-- ─── 8. subscription_status_grants_pro ──────────────────────────────────
-- Proを付与するSubscription statusの唯一の定義。
--   active / trialing : 有効
--   past_due          : 支払い失敗後、Stripeの再試行期間中。この間はProを維持する
--                       （ヘッダーの「past_due と Pro維持に関するリリース必須条件」参照）。
--   上記以外（canceled / unpaid / incomplete / incomplete_expired / paused /
--   将来追加される未知のstatus）: Proを付与しない（安全側）
-- status の遷移可否（終端かどうか）は決め打ちしない。常にStripeから取得した最新状態を正とする。
create or replace function public.subscription_status_grants_pro(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select coalesce(p_status in ('active', 'trialing', 'past_due'), false);
$function$;


-- ─── 9. recompute_plan ──────────────────────────────────────────────────
-- 権利の正本から profiles.plan を再計算する。冪等（何度呼んでも同じ結果）。
-- plan が変わらない場合は UPDATE しない（updated_at も変えない）。
-- 対象ユーザーの profiles 行が無い場合は例外（grant_ads_removed と同じ方針）。
-- profiles 行を FOR UPDATE でロックするため、grant_ads_removed との同時実行は
-- 行ロックで直列化され、後に実行された側は最新の行を読んで計算する。
-- 移行期間用の旧来Pro保護は持たない（ヘッダーのリリース必須手順 R2/R3 で担保する）。
-- 戻り値：計算後の plan。
create or replace function public.recompute_plan(target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pro_override boolean;
  v_ads_removed_purchased_at timestamptz;
  v_has_pro_subscription boolean;
  v_new_plan text;
begin
  select p.pro_override, p.ads_removed_purchased_at
    into v_pro_override, v_ads_removed_purchased_at
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception
      'recompute_plan: user % に対応する profiles 行が見つかりません', target_user_id;
  end if;

  select exists (
    select 1
    from public.subscriptions s
    join public.stripe_pro_prices pp on pp.price_id = s.price_id
    where s.user_id = target_user_id
      and public.subscription_status_grants_pro(s.status)
  ) into v_has_pro_subscription;

  v_new_plan := case
    when v_pro_override                         then 'pro'
    when v_has_pro_subscription                 then 'pro'
    when v_ads_removed_purchased_at is not null then 'ads_removed'
    else 'free'
  end;

  update public.profiles
  set plan = v_new_plan,
      updated_at = now()
  where id = target_user_id
    and plan is distinct from v_new_plan;

  return v_new_plan;
end;
$function$;


-- ─── 10. link_billing_customer ──────────────────────────────────────────
-- Supabaseユーザーと Stripe Customer を1対1で紐付ける。冪等。
--   - 既に同じ組み合わせで登録済み → 何もしない
--   - そのCustomerが別ユーザーに紐付いている → 例外
--   - そのユーザーが別Customerに紐付いている → 例外
-- （Pro Checkout作成時・Subscription同期時の両方から使う想定）
-- 同時実行で同じ組み合わせを INSERT し合った場合（同じ user/customer の新規Subscriptionが
-- 並行して complete される等）は、後発が一意制約違反の例外となりトランザクション全体が
-- ロールバックされる（fail-closed）。誤った紐付けは起きず、一時的な500になるだけで、
-- Stripe再送 または reconciliation により、既に登録済みの紐付けを使って収束する。
-- 追加のロック機構（advisory lock等）は意図的に設けない。
create or replace function public.link_billing_customer(
  target_user_id uuid,
  p_stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_linked_user_id uuid;
  v_linked_customer_id text;
begin
  if target_user_id is null or coalesce(btrim(p_stripe_customer_id), '') = '' then
    raise exception 'link_billing_customer: 引数が不正です';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception
      'link_billing_customer: user % に対応する profiles 行が見つかりません', target_user_id;
  end if;

  select bc.user_id into v_linked_user_id
  from public.billing_customers bc
  where bc.stripe_customer_id = p_stripe_customer_id;

  if found then
    if v_linked_user_id <> target_user_id then
      raise exception
        'link_billing_customer: customer は既に別のユーザーに紐付いています';
    end if;
    return;
  end if;

  select bc.stripe_customer_id into v_linked_customer_id
  from public.billing_customers bc
  where bc.user_id = target_user_id;

  if found then
    raise exception
      'link_billing_customer: user % は既に別の customer に紐付いています', target_user_id;
  end if;

  insert into public.billing_customers (user_id, stripe_customer_id)
  values (target_user_id, p_stripe_customer_id);
end;
$function$;


-- ─── 11. request_subscription_sync ──────────────────────────────────────
-- 同期要求を記録する（Stripe APIはまだ呼ばない）。
--   p_event_id あり（Webhook）：
--     台帳へ INSERT ... ON CONFLICT DO NOTHING。
--       新規受付   → requested_seq を +1 し 'requested'
--       受付済み   → 未同期の要求が残っていれば 'duplicate_pending'（同期を続行してよい）
--                     残っていなければ 'duplicate_done'（何もしなくてよい）
--     同じ event_id が同時に到着した場合、後発は先発のトランザクション完了まで
--     一意インデックスで待ち、先発がコミットすれば受付済み扱いになる。
--   p_event_id が NULL（reconciliation）：台帳を使わず requested_seq を +1 し 'requested'。
create or replace function public.request_subscription_sync(
  p_stripe_subscription_id text,
  p_event_id text,
  p_event_type text,
  p_event_created timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inserted integer;
  v_pending boolean;
begin
  if coalesce(btrim(p_stripe_subscription_id), '') = '' then
    raise exception 'request_subscription_sync: subscription id が不正です';
  end if;

  if p_event_id is not null then
    if btrim(p_event_id) = '' or coalesce(btrim(p_event_type), '') = '' or p_event_created is null then
      raise exception 'request_subscription_sync: event 情報が不正です';
    end if;

    insert into public.stripe_webhook_events (
      event_id, event_type, event_created_at, stripe_subscription_id
    ) values (
      p_event_id, p_event_type, p_event_created, p_stripe_subscription_id
    )
    on conflict (event_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      select (s.requested_seq > s.synced_seq) into v_pending
      from public.subscription_sync_state s
      where s.stripe_subscription_id = p_stripe_subscription_id;

      return case when coalesce(v_pending, false) then 'duplicate_pending' else 'duplicate_done' end;
    end if;
  end if;

  insert into public.subscription_sync_state as ss (stripe_subscription_id, requested_seq)
  values (p_stripe_subscription_id, 1)
  on conflict (stripe_subscription_id) do update
    set requested_seq = ss.requested_seq + 1,
        updated_at    = now();

  return 'requested';
end;
$function$;


-- ─── 12. acquire_subscription_sync_lease ────────────────────────────────
-- 未同期の要求があり、有効なleaseが無い場合だけ lease を発行する。
-- 戻り値 result：
--   'acquired'   … lease_token を返す。呼び出し元はこの後に Stripe API で最新状態を取得する
--   'busy'       … 他の処理が有効なleaseを保持中
--   'up_to_date' … 未同期の要求が無い（同期不要）
-- lease時間はDB側で60秒に固定する（呼び出し側から変更できない）。
-- 短すぎると lease_lost が増え、長すぎると異常終了時の回復が遅れるため、誤実装で
-- 任意の値を渡せないようにする。60秒はStripe API取得〜complete呼び出しに十分な長さ
-- として選んだ値であり、Vercel Functionの最大実行時間との関係はSTEP4で公式仕様を確認する。
-- 期限切れleaseは次の acquire で回収される。
create or replace function public.acquire_subscription_sync_lease(
  p_stripe_subscription_id text
)
returns table (result text, lease_token uuid)
language plpgsql
security definer
set search_path = public
as $function$
declare
  c_lease_duration constant interval := interval '60 seconds';
  v_state public.subscription_sync_state%rowtype;
  v_token uuid;
begin
  if coalesce(btrim(p_stripe_subscription_id), '') = '' then
    raise exception 'acquire_subscription_sync_lease: subscription id が不正です';
  end if;

  select * into v_state
  from public.subscription_sync_state
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if not found or v_state.requested_seq <= v_state.synced_seq then
    return query select 'up_to_date'::text, null::uuid;
    return;
  end if;

  if v_state.lease_token is not null and v_state.lease_expires_at > now() then
    return query select 'busy'::text, null::uuid;
    return;
  end if;

  v_token := gen_random_uuid();

  update public.subscription_sync_state
  set lease_token      = v_token,
      lease_seq        = v_state.requested_seq,
      lease_expires_at = now() + c_lease_duration,
      updated_at       = now()
  where stripe_subscription_id = p_stripe_subscription_id;

  return query select 'acquired'::text, v_token;
end;
$function$;


-- ─── 13. release_subscription_sync_lease ────────────────────────────────
-- Stripe API取得に失敗した等で保存せずに中断する場合に lease を解放する。
-- synced_seq は進めないため、未同期の要求は残り、再送・reconciliationで再実行される。
-- token が一致しない（既に失効・他処理へ移った）場合は何もしない。
create or replace function public.release_subscription_sync_lease(
  p_stripe_subscription_id text,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.subscription_sync_state
  set lease_token = null,
      lease_seq = null,
      lease_expires_at = null,
      updated_at = now()
  where stripe_subscription_id = p_stripe_subscription_id
    and lease_token = p_lease_token;
end;
$function$;


-- ─── 14. complete_subscription_sync ─────────────────────────────────────
-- lease 取得後に Stripe API から取得した最新Subscriptionを保存し、plan を再計算する。
-- 1回の呼び出し＝1トランザクションで、保存・recompute_plan・lease解放・synced_seq更新を行う。
--
-- 戻り値：
--   result       … 'applied'（保存した） / 'ignored'（新規候補だが追跡対象外） /
--                   'lease_lost'（lease token 不一致。何も保存していない）
--   needs_resync … 同期中に新しい要求が来ており、もう一度 acquire からやり直す必要がある
--
-- 追跡条件：
--   既存追跡（subscriptions に行がある）：
--     Price・metadata に関係なく必ず現在状態を保存する（Pro→非Pro変更も反映する）。
--     user_id / customer が保存済みの値と一致しない場合は例外。
--   新規追跡（subscriptions に行が無い）：次をすべて満たす場合のみ追跡を開始する。
--     - p_allow_new_tracking = true（Webhook側で metadata.product='pro' かつ
--       Price = STRIPE_PRO_PRICE_ID を最新状態で確認済み）
--     - p_price_id が stripe_pro_prices に登録済み（DB側の fail-closed）
--     満たさない場合は 'ignored'（何も保存しない。要求は同期済みとして扱う）。
--
-- lease token が一致する限り、lease期限を過ぎていても保存する
-- （token が一致する＝他の処理はこの lease 発行後に同期していないため、
--   この処理が lease 取得後に取得した状態が最新の保存となる）。
create or replace function public.complete_subscription_sync(
  p_stripe_subscription_id text,
  p_lease_token uuid,
  target_user_id uuid,
  p_stripe_customer_id text,
  p_status text,
  p_price_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_allow_new_tracking boolean
)
returns table (result text, needs_resync boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_state public.subscription_sync_state%rowtype;
  v_existing public.subscriptions%rowtype;
  v_result text;
begin
  if coalesce(btrim(p_stripe_subscription_id), '') = ''
     or p_lease_token is null
     or target_user_id is null
     or coalesce(btrim(p_stripe_customer_id), '') = ''
     or coalesce(btrim(p_status), '') = '' then
    raise exception 'complete_subscription_sync: 引数が不正です';
  end if;

  select * into v_state
  from public.subscription_sync_state
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if not found or v_state.lease_token is distinct from p_lease_token then
    return query select 'lease_lost'::text, false;
    return;
  end if;

  select * into v_existing
  from public.subscriptions
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if found then
    -- 既存追跡：Priceに関係なく現在状態を保存する
    if v_existing.user_id <> target_user_id then
      raise exception
        'complete_subscription_sync: subscription は別のユーザーに紐付いています';
    end if;
    if v_existing.stripe_customer_id <> p_stripe_customer_id then
      raise exception
        'complete_subscription_sync: subscription の customer が一致しません';
    end if;

    update public.subscriptions
    set status               = p_status,
        price_id             = nullif(btrim(p_price_id), ''),
        current_period_end   = p_current_period_end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
        status_changed_at    = case when status is distinct from p_status
                                    then now() else status_changed_at end,
        last_synced_at       = now(),
        updated_at           = now()
    where stripe_subscription_id = p_stripe_subscription_id;

    v_result := 'applied';
  elsif coalesce(p_allow_new_tracking, false)
        and exists (select 1 from public.stripe_pro_prices where price_id = p_price_id) then
    -- 新規追跡：Webhook側の確認とDB側のPro Price許可リストの両方を満たす場合のみ
    perform public.link_billing_customer(target_user_id, p_stripe_customer_id);

    insert into public.subscriptions (
      stripe_subscription_id, user_id, stripe_customer_id, status, price_id,
      current_period_end, cancel_at_period_end
    ) values (
      p_stripe_subscription_id, target_user_id, p_stripe_customer_id, p_status, p_price_id,
      p_current_period_end, coalesce(p_cancel_at_period_end, false)
    );

    v_result := 'applied';
  else
    v_result := 'ignored';
  end if;

  if v_result = 'applied' then
    perform public.recompute_plan(target_user_id);
  end if;

  update public.subscription_sync_state
  set synced_seq       = v_state.lease_seq,
      lease_token      = null,
      lease_seq        = null,
      lease_expires_at = null,
      updated_at       = now()
  where stripe_subscription_id = p_stripe_subscription_id;

  return query select v_result, (v_state.requested_seq > v_state.lease_seq);
end;
$function$;


-- ─── 15. 関数の実行権限：service_role のみ ─────────────────────────────
-- 新規関数は既定で PUBLIC に EXECUTE が付き、Supabaseの既定権限で
-- anon / authenticated にも付与されるため、明示的に剥奪する（0006と同じ方針）。
revoke execute on function public.subscription_status_grants_pro(text) from public, anon, authenticated;
revoke execute on function public.recompute_plan(uuid) from public, anon, authenticated;
revoke execute on function public.link_billing_customer(uuid, text) from public, anon, authenticated;
revoke execute on function public.request_subscription_sync(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.acquire_subscription_sync_lease(text)
  from public, anon, authenticated;
revoke execute on function public.release_subscription_sync_lease(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.complete_subscription_sync(
  text, uuid, uuid, text, text, text, timestamptz, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.subscription_status_grants_pro(text) to service_role;
grant execute on function public.recompute_plan(uuid) to service_role;
grant execute on function public.link_billing_customer(uuid, text) to service_role;
grant execute on function public.request_subscription_sync(text, text, text, timestamptz) to service_role;
grant execute on function public.acquire_subscription_sync_lease(text) to service_role;
grant execute on function public.release_subscription_sync_lease(text, uuid) to service_role;
grant execute on function public.complete_subscription_sync(
  text, uuid, uuid, text, text, text, timestamptz, boolean, boolean
) to service_role;


-- ─── 15-2. 権限構成の自己検証 ──────────────────────────────────────────
-- SECURITY DEFINER 関数は「関数所有者」の権限で実行される。本migrationで作成した
-- テーブルと関数は同じ実行ロール（通常 postgres）が所有するため、関数内部のDMLは
-- テーブル所有者として実行され、service_role の GRANT 状況に依存しない。
-- （所有者はテーブル権限を常に持ち、RLSも FORCE していないため所有者には適用されない。）
-- この前提と、APIロールからの直接書き込み禁止・RPC実行可否をここで確認する。
do $$
declare
  v_table text;
  v_priv text;
  v_role text;
  v_fn text;
  v_fn_owner name;
begin
  -- (a) APIロールは同期系テーブル・許可リストへ直接書き込めない
  foreach v_table in array array[
    'public.subscriptions', 'public.subscription_sync_state',
    'public.stripe_webhook_events', 'public.billing_customers', 'public.stripe_pro_prices'
  ] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(v_role, v_table, v_priv) then
          raise exception '0008: % に % の % 権限が残っています。', v_role, v_table, v_priv;
        end if;
      end loop;
    end loop;
  end loop;

  -- (b) 各RPC：service_role は実行可、anon / authenticated は実行不可、
  --     かつ関数所有者が参照先テーブルへのDML権限を持つ
  foreach v_fn in array array[
    'public.recompute_plan(uuid)',
    'public.link_billing_customer(uuid, text)',
    'public.request_subscription_sync(text, text, text, timestamptz)',
    'public.acquire_subscription_sync_lease(text)',
    'public.release_subscription_sync_lease(text, uuid)',
    'public.complete_subscription_sync(text, uuid, uuid, text, text, text, timestamptz, boolean, boolean)'
  ] loop
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '0008: service_role が % を実行できません。', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '0008: anon / authenticated が % を実行できます。', v_fn;
    end if;

    select pg_get_userbyid(p.proowner) into v_fn_owner
    from pg_proc p where p.oid = to_regprocedure(v_fn);

    foreach v_table in array array[
      'public.profiles', 'public.subscriptions', 'public.subscription_sync_state',
      'public.stripe_webhook_events', 'public.billing_customers'
    ] loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
        if not has_table_privilege(v_fn_owner, v_table, v_priv) then
          raise exception '0008: % の所有者 % に % の % 権限がありません。',
            v_fn, v_fn_owner, v_table, v_priv;
        end if;
      end loop;
    end loop;
  end loop;
end
$$;


-- ─── 16. 事後検証 ───────────────────────────────────────────────────────
-- 本migrationは plan 列を書き換えない。既存データが新しい計算ルールと
-- 矛盾していないことだけを確認する（この検証はmigration時の1回限り）。
--   - 旧来Pro（plan='pro'・override未設定）は、リリース必須手順 R2 で移行する対象のため
--     NOTICE で件数を報告するのみ。
--   - それ以外で plan と計算結果が一致しない行があれば migration 全体を中断する。
do $$
declare
  v_mismatch integer;
  v_legacy_pro integer;
begin
  select count(*) into v_legacy_pro
  from public.profiles p
  where p.plan = 'pro' and not p.pro_override;

  select count(*) into v_mismatch
  from public.profiles p
  where not (p.plan = 'pro' and not p.pro_override)
    and p.plan is distinct from (
      case
        when p.pro_override then 'pro'
        when exists (
          select 1
          from public.subscriptions s
          join public.stripe_pro_prices pp on pp.price_id = s.price_id
          where s.user_id = p.id
            and public.subscription_status_grants_pro(s.status)
        ) then 'pro'
        when p.ads_removed_purchased_at is not null then 'ads_removed'
        else 'free'
      end
    );

  if v_mismatch > 0 then
    raise exception
      '0008: plan と権利の正本から計算した plan が一致しない行が % 件あります。', v_mismatch;
  end if;

  raise notice
    '0008: 旧来Pro（pro_override未設定）が % 件あります。'
    'STEP4有効化の前に、ヘッダーのリリース必須手順 R2/R3 を完了してください。', v_legacy_pro;
end
$$;


-- ============================================================================
-- ロールバック用SQL（参考・コメントアウトのため実行されない）
-- ============================================================================
-- 注意：
--   - Subscriptionが稼働した後にロールバックすると、Subscription由来の
--     plan='pro' がキャッシュとして残り、解約しても戻らなくなる。
--     稼働後のロールバックは、全ユーザーの plan を手動で整理する必要がある。
--   - 2.（profiles の INSERT / DELETE / TRUNCATE 剥奪）は巻き戻さないこと。
--     アプリはprofilesへINSERT/DELETEしないため、剥奪したままでも動作に影響しない。
--     特に TRUNCATE は RLS で保護されないため、anon / authenticated へ再GRANTしてはならない。
--     どうしても権限を戻す必要がある場合は、適用前の権限状態（STEP2.5 Q6/Q12 の
--     確認結果）と照合し、必要最小限の権限だけを個別に判断して戻すこと。
--   - pro_override を削除しても、明示設定済みの開発者アカウントの plan='pro' は
--     そのまま残る（plan はキャッシュのため値は消えない）。
--   - stripe_webhook_events を削除すると、同じ Event ID の再受付を防げなくなる。
--
-- drop function if exists public.complete_subscription_sync(
--   text, uuid, uuid, text, text, text, timestamptz, boolean, boolean);
-- drop function if exists public.release_subscription_sync_lease(text, uuid);
-- drop function if exists public.acquire_subscription_sync_lease(text);
-- drop function if exists public.request_subscription_sync(text, text, text, timestamptz);
-- drop function if exists public.link_billing_customer(uuid, text);
-- drop function if exists public.recompute_plan(uuid);
-- drop function if exists public.subscription_status_grants_pro(text);
-- drop table if exists public.stripe_webhook_events;
-- drop table if exists public.subscription_sync_state;
-- drop table if exists public.subscriptions;
-- drop table if exists public.billing_customers;
-- drop table if exists public.stripe_pro_prices;
-- alter table public.profiles drop column if exists pro_override;
-- ============================================================================
