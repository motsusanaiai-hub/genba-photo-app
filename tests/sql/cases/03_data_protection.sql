-- ============================================================================
-- 03：既存データの保護
--   検証項目 7. Pro → Free / ads_removed への切り替えで工事案件・写真・フォルダを削除しない
-- ============================================================================

do $$
declare
  t_free uuid := test_helpers.create_user('data-free@example.com');
  t_ads uuid := test_helpers.create_user('data-ads@example.com');
  v_project uuid;
  v_before_free text;
  v_before_ads text;
begin
  perform test_helpers.register_pro_price('price_pro_test');

  -- Pro 契約中に、上限（3件）を超える工事案件と写真・フォルダを作る
  perform test_helpers.sync('sub_data_free', t_free, 'cus_data_free', 'active', 'price_pro_test');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_free), 'pro', '準備：pro');
  for i in 1..5 loop
    v_project := test_helpers.create_project_data(t_free);
  end loop;
  v_before_free := test_helpers.data_fingerprint(t_free);
  perform test_helpers.assert_true(v_before_free like '5:%/5:%/10:%', '準備：工事案件5件・フォルダ5件・写真10件');

  perform public.grant_ads_removed(t_ads);
  perform test_helpers.sync('sub_data_ads', t_ads, 'cus_data_ads', 'active', 'price_pro_test');
  v_project := test_helpers.create_project_data(t_ads);
  v_before_ads := test_helpers.data_fingerprint(t_ads);

  -- 解約予約 → 契約終了 → 同じイベントの再送 → 再計算
  perform test_helpers.sync('sub_data_free', t_free, 'cus_data_free', 'active', 'price_pro_test', true);
  perform test_helpers.sync('sub_data_free', t_free, 'cus_data_free', 'canceled', 'price_pro_test', false, true, 'evt_data_deleted');
  perform test_helpers.sync('sub_data_free', t_free, 'cus_data_free', 'canceled', 'price_pro_test', false, true, 'evt_data_deleted');
  perform public.recompute_plan(t_free);
  perform test_helpers.sync('sub_data_ads', t_ads, 'cus_data_ads', 'canceled', 'price_pro_test');

  perform test_helpers.assert_eq(test_helpers.plan_of(t_free), 'free', '切り替え後：free');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_ads), 'ads_removed', '切り替え後：ads_removed');

  perform test_helpers.assert_eq(test_helpers.data_fingerprint(t_free), v_before_free,
    '7. Pro → free で工事案件・フォルダ・写真の件数と内容が変わらない（上限超過分も残る）');
  perform test_helpers.assert_eq(test_helpers.data_fingerprint(t_ads), v_before_ads,
    '7. Pro → ads_removed で工事案件・フォルダ・写真の件数と内容が変わらない');
  perform test_helpers.assert_true(
    not exists (select 1 from public.projects where user_id = t_free and deleted_at is not null),
    'soft delete（deleted_at）も付かない');
end
$$;

-- plan を決める処理が、工事案件・写真・フォルダに触れる経路を持たないこと（構造の確認）
do $$
declare
  v_count integer;
begin
  -- 課金・plan 関連のテーブルに、他のテーブルを変更し得るユーザー定義トリガーが無い
  select count(*) into v_count
  from pg_trigger
  where not tgisinternal
    and tgrelid in (
      'public.profiles'::regclass, 'public.subscriptions'::regclass, 'public.billing_customers'::regclass,
      'public.subscription_sync_state'::regclass, 'public.stripe_webhook_events'::regclass,
      'public.stripe_pro_prices'::regclass
    );
  perform test_helpers.assert_eq(v_count::text, '0', 'plan・課金関連のテーブルにユーザー定義トリガーが無い');

  -- plan を変更する関数の本文が、工事案件・写真・フォルダのテーブルを参照しない
  select count(*) into v_count
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (
      'recompute_plan', 'complete_subscription_sync', 'request_subscription_sync',
      'acquire_subscription_sync_lease', 'release_subscription_sync_lease',
      'link_billing_customer', 'grant_ads_removed'
    )
    and p.prosrc ~* '\m(projects|photos|photo_folders)\M';
  perform test_helpers.assert_eq(v_count::text, '0', 'plan を変更する関数は工事案件・写真・フォルダを参照しない');
end
$$;
