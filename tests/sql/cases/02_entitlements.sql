-- ============================================================================
-- 02：権利の優先順位
--   検証項目 4. 広告削除購入済みなら ads_removed / 5. pro_override は最優先
--            6. 未登録 Price では Pro を付与しない
-- ============================================================================

-- 4. 広告削除（買い切り）購入済みのユーザー
do $$
declare
  t_user uuid := test_helpers.create_user('ads@example.com');
begin
  perform test_helpers.register_pro_price('price_pro_test');

  perform public.grant_ads_removed(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'ads_removed', '広告削除の購入で ads_removed');

  perform test_helpers.sync('sub_ads', t_user, 'cus_ads', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '広告削除済みでも Pro 契約中は pro');

  perform test_helpers.sync('sub_ads', t_user, 'cus_ads', 'canceled', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'ads_removed', '4. Pro 終了後は ads_removed に戻る');
  perform test_helpers.assert_true(
    (select ads_removed_purchased_at is not null from public.profiles where id = t_user),
    '広告削除の購入記録は残る');
end
$$;

-- Pro 契約中に広告削除を購入した場合（Checkout では拒否されるが、DB上の結果も確認する）
do $$
declare
  t_user uuid := test_helpers.create_user('pro-then-ads@example.com');
begin
  perform test_helpers.register_pro_price('price_pro_test');
  perform test_helpers.sync('sub_pro_ads', t_user, 'cus_pro_ads', 'active', 'price_pro_test');
  perform public.grant_ads_removed(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', 'Pro 契約中に広告削除を付与しても pro のまま');
  perform test_helpers.sync('sub_pro_ads', t_user, 'cus_pro_ads', 'canceled', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'ads_removed', 'その後 Pro が終了すると ads_removed');
end
$$;

-- 5. pro_override（開発者アカウント）は最優先
do $$
declare
  t_user uuid := test_helpers.create_user('developer@example.com');
begin
  perform test_helpers.register_pro_price('price_pro_test');

  update public.profiles set pro_override = true where id = t_user;
  perform public.recompute_plan(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', 'pro_override だけで pro');

  perform public.grant_ads_removed(t_user);
  perform test_helpers.sync('sub_dev', t_user, 'cus_dev', 'active', 'price_pro_test');
  perform test_helpers.sync('sub_dev', t_user, 'cus_dev', 'canceled', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '5. 契約終了・広告削除購入済みでも pro_override なら pro');

  update public.profiles set pro_override = false where id = t_user;
  perform public.recompute_plan(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'ads_removed', 'override を外すと次の権利（ads_removed）になる');
end
$$;

-- 6. 未登録の Price では Pro を付与しない
do $$
declare
  t_user uuid := test_helpers.create_user('unknown-price@example.com');
  v_result text;
begin
  perform test_helpers.register_pro_price('price_pro_test');

  -- 新規追跡：Price が許可リストに無い → 保存しない
  v_result := test_helpers.sync('sub_unknown', t_user, 'cus_unknown', 'active', 'price_not_registered');
  perform test_helpers.assert_eq(v_result, 'ignored', '未登録 Price の新規契約は ignored');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '6. 未登録 Price では pro にならない');
  perform test_helpers.assert_true(
    not exists (select 1 from public.subscriptions where stripe_subscription_id = 'sub_unknown'),
    '未登録 Price の契約は subscriptions に保存されない');

  -- 新規追跡：Webhook 側の確認（allow_new_tracking）が false → 保存しない
  v_result := test_helpers.sync('sub_not_allowed', t_user, 'cus_unknown', 'active', 'price_pro_test', false, false);
  perform test_helpers.assert_eq(v_result, 'ignored', 'allow_new_tracking=false の新規契約は ignored');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', 'allow_new_tracking=false では pro にならない');

  -- Price が無い（item が複数等）→ 保存しない
  v_result := test_helpers.sync('sub_no_price', t_user, 'cus_unknown', 'active', null);
  perform test_helpers.assert_eq(v_result, 'ignored', 'Price を特定できない新規契約は ignored');
end
$$;

-- 既存の契約の Price が未登録のものに変わった場合 / 許可リストから削除した場合
do $$
declare
  t_user uuid := test_helpers.create_user('price-change@example.com');
  v_result text;
begin
  perform test_helpers.register_pro_price('price_pro_test');
  perform test_helpers.sync('sub_change', t_user, 'cus_change', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '登録済み Price の契約で pro');

  v_result := test_helpers.sync('sub_change', t_user, 'cus_change', 'active', 'price_other');
  perform test_helpers.assert_eq(v_result, 'applied', '既存契約は Price が変わっても保存される');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '未登録 Price に変わると pro を外す');

  perform test_helpers.sync('sub_change', t_user, 'cus_change', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'pro', '登録済み Price に戻ると pro');

  delete from public.stripe_pro_prices where price_id = 'price_pro_test';
  perform public.recompute_plan(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'free', '許可リストから Price を削除すると次の再計算で free');
  perform test_helpers.register_pro_price('price_pro_test');
end
$$;

-- 別ユーザー・別 Customer の取り違え防止（complete_subscription_sync の整合性チェック）
do $$
declare
  t_owner uuid := test_helpers.create_user('owner@example.com');
  t_other uuid := test_helpers.create_user('other@example.com');
  v_state text;
begin
  perform test_helpers.register_pro_price('price_pro_test');
  perform test_helpers.sync('sub_owner', t_owner, 'cus_owner', 'active', 'price_pro_test');

  begin
    perform test_helpers.sync('sub_owner', t_other, 'cus_owner', 'active', 'price_pro_test');
  exception when raise_exception then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform test_helpers.assert_eq(v_state, 'P0001', '既存契約を別ユーザーへ付け替えようとすると例外');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_other), 'free', '付け替えに失敗した別ユーザーは free のまま');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_owner), 'pro', '元の契約者は pro のまま');
end
$$;

-- 既存の広告削除購入者：Webhook の再送などで grant_ads_removed が再実行されても、
-- 過去の購入日時と ads_removed は変わらない
-- （テストは1トランザクション内で now() が固定のため、購入日時は過去の値を明示的に置いて確認する）
do $$
declare
  t_user uuid := test_helpers.create_user('ads-regrant@example.com');
  c_purchased_at constant timestamptz := '2026-09-01 10:00:00+09';
begin
  perform public.grant_ads_removed(t_user);
  update public.profiles set ads_removed_purchased_at = c_purchased_at where id = t_user;

  perform public.grant_ads_removed(t_user);
  perform test_helpers.assert_eq(test_helpers.plan_of(t_user), 'ads_removed', '再付与しても ads_removed のまま');
  perform test_helpers.assert_true(
    (select ads_removed_purchased_at = c_purchased_at from public.profiles where id = t_user),
    '再付与しても既存の購入日時が保持される');
end
$$;
