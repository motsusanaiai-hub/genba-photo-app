-- ============================================================================
-- SQLテスト用のヘルパー（Migration 適用後に読み込む）
-- ============================================================================
-- public ではなく専用スキーマ test_helpers に置き、アプリのテーブル・権限と混ざらないようにする。
-- 同期処理は Webhook（api/_lib/proSubscriptionSync.ts）と同じ順序で RPC を呼ぶ：
--   request_subscription_sync → acquire_subscription_sync_lease → complete_subscription_sync
-- ============================================================================

create schema test_helpers;
-- ロールを切り替えた後も assert / ロール復帰の関数を呼べるようにする（関数のEXECUTEはPUBLICに既定で付く）。
grant usage on schema test_helpers to anon, authenticated, service_role;

-- ─── アサーション ───────────────────────────────────────────────────────
create function test_helpers.assert_eq(actual text, expected text, label text)
returns void
language plpgsql
as $function$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', label, coalesce(expected, 'NULL'), coalesce(actual, 'NULL');
  end if;
  raise notice 'ok: %', label;
end;
$function$;

create function test_helpers.assert_true(condition boolean, label text)
returns void
language plpgsql
as $function$
begin
  if condition is not true then
    raise exception 'FAIL: % (condition was %)', label, coalesce(condition::text, 'NULL');
  end if;
  raise notice 'ok: %', label;
end;
$function$;

/**
 * sql を現在のロールで実行し、指定の SQLSTATE とメッセージで失敗することを確認する。
 * GRANT による拒否は 'permission denied for ...'、RLS による拒否は
 * 'new row violates row-level security policy ...'（どちらも SQLSTATE 42501）で区別する。
 */
create function test_helpers.expect_error(sql text, expected_state text, message_like text, label text)
returns void
language plpgsql
as $function$
declare
  v_state text;
  v_message text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;

  if v_state is null then
    raise exception 'FAIL: % (expected error %, but the statement succeeded)', label, expected_state;
  end if;
  if v_state <> expected_state or v_message not like message_like then
    raise exception 'FAIL: % (expected % "%", got % "%")', label, expected_state, message_like, v_state, v_message;
  end if;
  raise notice 'ok: % [% %]', label, v_state, v_message;
end;
$function$;

/** sql を現在のロールで実行し、影響を受けた行数を返す（RLSで対象外の行は 0 になる）。 */
create function test_helpers.rows_affected(sql text)
returns bigint
language plpgsql
as $function$
declare
  v_count bigint;
begin
  execute sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

/** select の結果件数を現在のロールで数える（RLSで見えない行は数えられない）。 */
create function test_helpers.count_rows(sql text)
returns bigint
language plpgsql
as $function$
declare
  v_count bigint;
begin
  execute format('select count(*) from (%s) as t', sql) into v_count;
  return v_count;
end;
$function$;

-- ─── ロールの切り替え（PostgREST と同じく role と request.jwt.claims をトランザクション内で設定） ──
create function test_helpers.as_user(user_id uuid)
returns void
language plpgsql
as $function$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$function$;

create function test_helpers.as_anon()
returns void
language plpgsql
as $function$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$function$;

create function test_helpers.as_service_role()
returns void
language plpgsql
as $function$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end;
$function$;

create function test_helpers.as_admin()
returns void
language plpgsql
as $function$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$function$;

-- ─── テストデータ ───────────────────────────────────────────────────────
/** auth.users に追加する（0002 の on_auth_user_created により profiles 行が作られる）。 */
create function test_helpers.create_user(email text)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid;
begin
  insert into auth.users (email) values (email) returning id into v_id;
  return v_id;
end;
$function$;

create function test_helpers.plan_of(user_id uuid)
returns text
language sql
as $function$
  select plan from public.profiles where id = user_id
$function$;

create function test_helpers.register_pro_price(price_id text)
returns void
language sql
as $function$
  insert into public.stripe_pro_prices (price_id) values (price_id) on conflict do nothing
$function$;

/**
 * Webhook 1件分の同期を行い、complete_subscription_sync の result を返す。
 * Stripe から retrieve した最新状態の代わりに、引数の値をそのまま渡す。
 */
create function test_helpers.sync(
  subscription_id text,
  user_id uuid,
  customer_id text,
  status text,
  price_id text,
  cancel_at_period_end boolean default false,
  allow_new_tracking boolean default true,
  event_id text default null
)
returns text
language plpgsql
as $function$
declare
  v_request text;
  v_acquire_result text;
  v_token uuid;
  v_complete_result text;
begin
  select public.request_subscription_sync(
    subscription_id,
    coalesce(event_id, 'evt_' || gen_random_uuid()::text),
    'customer.subscription.updated',
    now()
  ) into v_request;

  if v_request = 'duplicate_done' then
    return 'duplicate_done';
  end if;

  select a.result, a.lease_token into v_acquire_result, v_token
  from public.acquire_subscription_sync_lease(subscription_id) as a;

  if v_acquire_result <> 'acquired' then
    return v_acquire_result;
  end if;

  select c.result into v_complete_result
  from public.complete_subscription_sync(
    subscription_id,
    v_token,
    user_id,
    customer_id,
    status,
    price_id,
    now() + interval '30 days',
    cancel_at_period_end,
    allow_new_tracking
  ) as c;

  return v_complete_result;
end;
$function$;

/** 工事案件・写真・フォルダの内容の指紋（行の内容が1文字でも変われば変わる）。 */
create function test_helpers.data_fingerprint(user_id uuid)
returns text
language sql
as $function$
  select concat_ws(
    '/',
    (select count(*) || ':' || md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.projects p where p.user_id = data_fingerprint.user_id),
    (select count(*) || ':' || md5(coalesce(string_agg(f::text, '|' order by f.id), '')) from public.photo_folders f where f.user_id = data_fingerprint.user_id),
    (select count(*) || ':' || md5(coalesce(string_agg(ph::text, '|' order by ph.id), '')) from public.photos ph where ph.user_id = data_fingerprint.user_id)
  )
$function$;

/** 工事案件1件・フォルダ1件・写真2件を作る（管理者として直接INSERT）。 */
create function test_helpers.create_project_data(user_id uuid)
returns uuid
language plpgsql
as $function$
declare
  v_project uuid := gen_random_uuid();
  v_folder uuid := gen_random_uuid();
begin
  insert into public.projects (id, user_id, name, location)
  values (v_project, user_id, 'テスト工事', '東京都');
  insert into public.photo_folders (id, project_id, user_id, name)
  values (v_folder, v_project, user_id, '着工前');
  insert into public.photos (id, project_id, user_id, original_filename, folder_id)
  values
    (gen_random_uuid(), v_project, user_id, 'a.jpg', v_folder),
    (gen_random_uuid(), v_project, user_id, 'b.jpg', null);
  return v_project;
end;
$function$;

/** 実行中のモード（scripts/test-sql.sh が alter database で設定する：new / legacy）。 */
create function test_helpers.mode()
returns text
language sql
stable
as $function$
  select current_setting('test.mode')
$function$;
