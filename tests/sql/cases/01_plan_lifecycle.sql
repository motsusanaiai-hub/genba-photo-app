-- ============================================================================
-- 01：Pro契約のライフサイクルと profiles.plan
--   検証項目 1. 契約中は pro / 2. 解約予約中も pro / 3. 契約終了後は free
-- ============================================================================

do $$
declare
  t_user uuid := test_helpers.create_user('lifecycle@example.com');
  v_result text;
begin
  perform test_helpers.register_pro_price('price_pro_test');

  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '新規ユーザーは free');

  -- 1. 契約開始（新規追跡）
  v_result := test_helpers.sync('sub_life', t_user, 'cus_life', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(v_result, 'applied', '新規のPro契約は保存される');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '1. 契約中（active）は pro');
  perform test_helpers.assert_true(
    exists (select 1 from public.billing_customers where user_id = t_user and stripe_customer_id = 'cus_life'),
    '新規追跡で Customer が紐付けられる');

  -- 2. 解約予約（期間終了時に解約）
  perform test_helpers.sync('sub_life', t_user, 'cus_life', 'active', 'price_pro_test', true);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '2. 解約予約中も pro');
  perform test_helpers.assert_true(
    (select cancel_at_period_end from public.subscriptions where stripe_subscription_id = 'sub_life'),
    '解約予約が subscriptions.cancel_at_period_end に保存される');

  -- 解約予約の取り消し
  perform test_helpers.sync('sub_life', t_user, 'cus_life', 'active', 'price_pro_test', false);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '解約予約の取り消し後も pro');
  perform test_helpers.assert_true(
    not (select cancel_at_period_end from public.subscriptions where stripe_subscription_id = 'sub_life'),
    '取り消すと cancel_at_period_end が false に戻る');

  -- 3. 契約終了
  perform test_helpers.sync('sub_life', t_user, 'cus_life', 'canceled', 'price_pro_test', false, true, 'evt_life_deleted');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '3. 契約終了（canceled）後は free');
  perform test_helpers.assert_eq(
    (select status from public.subscriptions where stripe_subscription_id = 'sub_life'),
    'canceled', 'subscriptions.status が canceled になる');

  -- 同じイベントの再送は重複として扱われ、状態は変わらない
  v_result := test_helpers.sync('sub_life', t_user, 'cus_life', 'active', 'price_pro_test', false, true, 'evt_life_deleted');
  perform test_helpers.assert_eq(v_result, 'duplicate_done', '同じ Event ID の再送は duplicate_done');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '再送後も free のまま');

  -- 終了後に新しい契約を結ぶと再び pro（同じ Customer を再利用）
  perform test_helpers.sync('sub_life_2', t_user, 'cus_life', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '再契約で pro に戻る');
  perform test_helpers.sync('sub_life_2', t_user, 'cus_life', 'canceled', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '再契約の終了で free に戻る');
end
$$;

-- status ごとの Pro 付与（0008 の subscription_status_grants_pro）
do $$
declare
  t_user uuid := test_helpers.create_user('status@example.com');
  v_status text;
  v_expected text;
begin
  perform test_helpers.register_pro_price('price_pro_test');
  perform test_helpers.sync('sub_status', t_user, 'cus_status', 'active', 'price_pro_test');

  for v_status, v_expected in
    select * from (values
      ('trialing', 'pro'), ('past_due', 'pro'), ('active', 'pro'),
      ('unpaid', 'free'), ('incomplete', 'free'), ('paused', 'free'),
      ('incomplete_expired', 'free'), ('some_future_status', 'free'), ('active', 'pro')
    ) as t(s, e)
  loop
    perform test_helpers.sync('sub_status', t_user, 'cus_status', v_status, 'price_pro_test');
    perform test_helpers.assert_eq(test_helpers.plan_of(t_user), v_expected, format('status=%s → %s', v_status, v_expected));
  end loop;
end
$$;
