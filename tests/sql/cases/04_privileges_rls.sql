-- ============================================================================
-- 04：権限（GRANT）と行単位の制御（RLS）
--   検証項目 8. 0009 の権限設定 / 9. RLS で他人のデータが見えない / 10. plan を直接変更できない
--
-- GRANT と RLS は次の基準で区別する（どちらも SQLSTATE 42501）：
--   GRANT による拒否 … 'permission denied for ...'（文そのものが実行できない）
--   RLS による拒否   … 'new row violates row-level security policy ...'（INSERT/UPDATE後の行が条件外）
--                      または、エラーにならず対象行が 0 件になる（SELECT/UPDATE/DELETE）
-- ============================================================================

do $$
declare
  t_a uuid := test_helpers.create_user('rls-a@example.com');
  t_b uuid := test_helpers.create_user('rls-b@example.com');
  v_project_a uuid;
  v_project_b uuid;
begin
  perform test_helpers.register_pro_price('price_pro_test');
  v_project_a := test_helpers.create_project_data(t_a);
  v_project_b := test_helpers.create_project_data(t_b);
  perform test_helpers.sync('sub_rls_a', t_a, 'cus_rls_a', 'active', 'price_pro_test');
  perform test_helpers.sync('sub_rls_b', t_b, 'cus_rls_b', 'active', 'price_pro_test');

  -- ════════ GRANT：authenticated（ログイン中の本人でも実行できない操作） ════════
  perform test_helpers.as_user(t_a);

  perform test_helpers.expect_error(format('update public.profiles set plan = %L where id = %L', 'pro', t_a),
    '42501', 'permission denied%', '10. [GRANT] authenticated は自分の plan を UPDATE できない');
  perform test_helpers.expect_error(format('update public.profiles set pro_override = true where id = %L', t_a),
    '42501', 'permission denied%', '[GRANT] authenticated は pro_override を UPDATE できない');
  perform test_helpers.expect_error(format('update public.profiles set ads_removed_purchased_at = now() where id = %L', t_a),
    '42501', 'permission denied%', '[GRANT] authenticated は ads_removed_purchased_at を UPDATE できない');
  perform test_helpers.expect_error(format('insert into public.profiles (id, display_name, plan) values (%L, %L, %L)', gen_random_uuid(), 'x', 'pro'),
    '42501', 'permission denied%', '[GRANT] authenticated は profiles に INSERT できない');
  perform test_helpers.expect_error(format('delete from public.profiles where id = %L', t_a),
    '42501', 'permission denied%', '[GRANT] authenticated は profiles を DELETE できない');
  perform test_helpers.expect_error('truncate public.profiles',
    '42501', 'permission denied%', '[GRANT] authenticated は profiles を TRUNCATE できない');
  perform test_helpers.expect_error(format('delete from public.projects where id = %L', v_project_a),
    '42501', 'permission denied%', '[GRANT] authenticated は projects を物理DELETEできない（0005）');
  perform test_helpers.expect_error(format('select public.recompute_plan(%L)', t_a),
    '42501', 'permission denied%', '[GRANT] authenticated は recompute_plan を実行できない');
  perform test_helpers.expect_error(format('select public.grant_ads_removed(%L)', t_a),
    '42501', 'permission denied%', '[GRANT] authenticated は grant_ads_removed を実行できない');
  perform test_helpers.expect_error(
    format('insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status) values (%L, %L, %L, %L)',
      'sub_fake', t_a, 'cus_rls_a', 'active'),
    '42501', 'permission denied%', '[GRANT] authenticated は subscriptions に INSERT できない');
  perform test_helpers.expect_error('select * from public.stripe_pro_prices',
    '42501', 'permission denied%', '[GRANT] authenticated は stripe_pro_prices を参照できない');
  perform test_helpers.expect_error('select * from public.subscription_sync_state',
    '42501', 'permission denied%', '[GRANT] authenticated は subscription_sync_state を参照できない');

  -- アプリが実際に行う操作は GRANT で許可されている（0009）
  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id, display_name, plan from public.profiles where id = %L', t_a))::text,
    '1', '8. [GRANT] authenticated は自分の profiles（id, display_name, plan）を参照できる');
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format('update public.profiles set display_name = %L where id = %L', '新しい名前', t_a))::text,
    '1', '8. [GRANT] authenticated は自分の display_name を UPDATE できる');
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format('update public.projects set deleted_at = now() where id = %L', v_project_a))::text,
    '1', '8. [GRANT] authenticated は自分の工事案件を soft delete できる');

  if test_helpers.mode() = 'new' then
    -- new モード（Staging相当）では profiles の列単位 GRANT だけのため、未許可の列は読めない
    perform test_helpers.expect_error('select * from public.profiles',
      '42501', 'permission denied%', '[GRANT/new] authenticated は profiles の未許可の列（pro_override 等）を参照できない');
  end if;

  -- ════════ RLS：GRANT はあるが、他人の行は見えない・変更できない ════════
  perform test_helpers.assert_eq(test_helpers.count_rows('select id from public.profiles')::text,
    '1', '9. [RLS] profiles は自分の1行だけ見える');
  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id from public.profiles where id = %L', t_b))::text,
    '0', '9. [RLS] 他人の profiles は見えない');
  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id from public.projects where user_id = %L', t_b))::text,
    '0', '9. [RLS] 他人の工事案件は見えない');
  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id from public.photos where user_id = %L', t_b))::text,
    '0', '9. [RLS] 他人の写真は見えない');
  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id from public.photo_folders where user_id = %L', t_b))::text,
    '0', '9. [RLS] 他人のフォルダは見えない');
  perform test_helpers.assert_eq(
    test_helpers.count_rows('select stripe_subscription_id from public.subscriptions')::text,
    '1', '9. [RLS] subscriptions は自分の契約だけ見える');
  perform test_helpers.assert_eq(
    test_helpers.count_rows('select stripe_customer_id from public.billing_customers')::text,
    '1', '9. [RLS] billing_customers は自分の行だけ見える');

  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format('update public.profiles set display_name = %L where id = %L', '乗っ取り', t_b))::text,
    '0', '9. [RLS] 他人の display_name は UPDATE できない（0件）');
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format('update public.projects set name = %L where id = %L', '乗っ取り', v_project_b))::text,
    '0', '9. [RLS] 他人の工事案件は UPDATE できない（0件）');
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format('delete from public.photos where user_id = %L', t_b))::text,
    '0', '9. [RLS] 他人の写真は DELETE できない（0件）');
  perform test_helpers.expect_error(
    format('insert into public.projects (id, user_id, name) values (%L, %L, %L)', gen_random_uuid(), t_b, 'なりすまし'),
    '42501', 'new row violates row-level security policy%', '9. [RLS] 他人名義の工事案件は INSERT できない');
  perform test_helpers.expect_error(
    format('insert into public.photo_folders (id, project_id, user_id, name) values (%L, %L, %L, %L)',
      gen_random_uuid(), v_project_b, t_a, '他人の工事に追加'),
    '42501', 'new row violates row-level security policy%', '9. [RLS] 他人の工事案件にフォルダを作れない（0007）');

  perform test_helpers.as_admin();

  perform test_helpers.assert_true(
    (select display_name <> '乗っ取り' from public.profiles where id = t_b),
    '9. 他人の display_name は変わっていない');
  perform test_helpers.assert_eq(test_helpers.plan_of(t_a), 'pro', '10. plan は直接変更されていない（契約による pro のまま）');
  perform test_helpers.assert_true(
    (select count(*) = 2 from public.photos where user_id = t_b),
    '9. 他人の写真は削除されていない');
end
$$;

-- ════════ anon（未ログイン） ════════
do $$
declare
  t_user uuid := test_helpers.create_user('rls-anon@example.com');
  v_table text;
begin
  perform test_helpers.create_project_data(t_user);
  perform test_helpers.as_anon();

  foreach v_table in array array['public.profiles', 'public.projects', 'public.photos', 'public.photo_folders'] loop
    if test_helpers.mode() = 'new' then
      perform test_helpers.expect_error(format('select id from %s', v_table),
        '42501', 'permission denied%', format('[GRANT/new] anon は %s を参照できない', v_table));
    else
      -- legacy（本番相当）では旧挙動の GRANT が残っているため、RLS で 0 件になる
      perform test_helpers.assert_eq(test_helpers.count_rows(format('select id from %s', v_table))::text,
        '0', format('[RLS/legacy] anon には %s の行が見えない', v_table));
    end if;
  end loop;

  perform test_helpers.expect_error(format('update public.profiles set plan = %L where id = %L', 'pro', t_user),
    '42501', 'permission denied%', '10. [GRANT] anon は plan を UPDATE できない');
  perform test_helpers.expect_error(format('select public.recompute_plan(%L)', t_user),
    '42501', 'permission denied%', '[GRANT] anon は recompute_plan を実行できない');

  perform test_helpers.as_admin();
end
$$;

-- ════════ service_role（サーバー側） ════════
do $$
declare
  t_user uuid := test_helpers.create_user('rls-service@example.com');
  v_plan text;
begin
  perform test_helpers.as_service_role();

  perform test_helpers.assert_eq(
    test_helpers.count_rows(format('select id, plan, pro_override from public.profiles where id = %L', t_user))::text,
    '1', '8. [GRANT] service_role は profiles の id, plan, pro_override を参照できる（0009）');
  perform test_helpers.expect_error(
    format('insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status) values (%L, %L, %L, %L)',
      'sub_direct', t_user, 'cus_direct', 'active'),
    '42501', 'permission denied%', '[GRANT] service_role も subscriptions へ直接 INSERT できない（RPC経由のみ）');
  perform test_helpers.expect_error('delete from public.stripe_webhook_events',
    '42501', 'permission denied%', '[GRANT] service_role は stripe_webhook_events を DELETE できない');

  execute format('select public.recompute_plan(%L)', t_user) into v_plan;
  perform test_helpers.as_admin();
  perform test_helpers.assert_eq(v_plan, 'free', '[GRANT] service_role は recompute_plan を実行できる');
end
$$;

-- ════════ 権限の一覧（has_*_privilege。モードによる違いを記録する） ════════
do $$
declare
  v_row record;
begin
  for v_row in
    select r.role_name, t.table_name,
      has_table_privilege(r.role_name, t.table_name, 'SELECT') as can_select,
      has_any_column_privilege(r.role_name, t.table_name, 'UPDATE') as can_update_any,
      has_table_privilege(r.role_name, t.table_name, 'DELETE') as can_delete
    from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
    cross join (values ('public.profiles'), ('public.projects'), ('public.photos'), ('public.photo_folders'), ('public.subscriptions')) as t(table_name)
    order by 1, 2
  loop
    raise notice 'info[%]: % % select=% update(any col)=% delete=%',
      test_helpers.mode(), v_row.role_name, v_row.table_name, v_row.can_select, v_row.can_update_any, v_row.can_delete;
  end loop;
end
$$;
