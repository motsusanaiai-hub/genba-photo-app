-- ============================================================================
-- アプリ用テーブルの明示的GRANT（profiles / projects / photos / photo_folders）
-- ============================================================================
-- 背景：
--   0001〜0007 は publicスキーマの既定権限（新規テーブルに anon / authenticated /
--   service_role へ ALL を自動付与する Supabase の旧挙動）に依存しており、
--   テーブル権限の GRANT を一切書いていなかった。
--   Supabase は新規プロジェクトでこの自動付与を廃止したため
--   （2026-05-30 以降の新規プロジェクト。2026-10-30 以降は既存プロジェクトの新規テーブルにも適用）、
--   migration だけで構築した環境（staging）では authenticated が profiles を
--   SELECT できず、ログイン直後に profiles 取得が 42501 で失敗していた。
--
-- 目的：
--   0001 から migration だけで新しい環境を構築しても、現在のアプリが動く
--   最小限の権限を明示的に付与する。
--
-- 方針：
--   - additive GRANT のみ。REVOKE は一切行わない。
--     既存環境（production）に残っている広いACLは削らない（本migrationは実質 no-op）。
--     不要権限の削減は、別途検証したうえで別migrationで行う。
--   - anon には4テーブルへの権限を付与しない（アプリはログイン前にこれらを参照しない）。
--   - authenticated には現在のアプリが実際に行う操作だけを付与する。
--     行の範囲は既存RLS（auth.uid() = user_id / id）で本人の行に限定される。
--     RLSはGRANTの代わりにならない（権限チェック → RLS の順に評価される）。
--   - UPDATE は列単位。現在のコードが実際に更新している列だけ。
--     新しい更新列が必要になった場合は、その時点のmigrationで明示的に追加する。
--   - service_role には現在のサーバーコードに必要な profiles の最小SELECTだけを付与する。
--     projects / photos / photo_folders へは付与しない（サーバーコードは利用者のJWTで参照する）。
--
-- 付与しないもの（既存のセキュリティ設計を維持する）：
--   - profiles の plan / ads_removed_purchased_at / pro_override の UPDATE（0003 / 0008）
--   - profiles の INSERT / DELETE / TRUNCATE（0008。行の作成は handle_new_user が行う）
--   - projects の DELETE（0005。削除は deleted_at による soft delete のみ）
--   - 課金関連の書き込みは従来どおり SECURITY DEFINER RPC
--     （grant_ads_removed / recompute_plan / link_billing_customer 等）経由のみ
--
-- 各権限が必要なコード：
--   profiles      authenticated SELECT (id, display_name, plan)
--                   src/hooks/useAuth.ts, src/pages/billing/CheckoutSuccessPage.tsx,
--                   api/create-checkout-session.ts（利用者のJWTで plan を参照）
--                 authenticated UPDATE (display_name) … 0003 で付与済み（本migrationでは触れない）
--                 service_role SELECT (id, plan, pro_override)
--                   api/create-pro-checkout-session.ts
--   projects      authenticated SELECT / INSERT, UPDATE (name, location, start_date,
--                   end_date, deleted_at, updated_at)
--                   src/lib/cloudSync.ts（一覧・作成・編集・soft delete）
--                   ※ photo_folders_insert_own（0007）は projects を利用者権限で参照するため、
--                     フォルダ作成にも projects の SELECT が必要
--   photos        authenticated SELECT / INSERT / DELETE, UPDATE (sort_order, phase, folder_id,
--                   previous_folder_id, comment, floor, location, storage_path, updated_at)
--                   src/lib/cloudSync.ts, src/hooks/usePhotos.ts, src/hooks/useCloudSync.ts,
--                   api/create-genbafoto-job.ts（利用者のJWTで id, storage_path を参照）
--   photo_folders authenticated SELECT / INSERT / DELETE, UPDATE (name, updated_at)
--                   src/lib/cloudSync.ts, src/hooks/usePhotoFolders.ts
--
-- 自己検証（末尾）：
--   「必要な権限があること」と「課金列・物理DELETE等が許可されていないこと」だけを確認する。
--   production に残っている広いACLがあっても失敗しないよう、
--   「不要権限が存在しないこと」は本migrationでは assert しない
--   （stagingでの厳密な最小権限確認は別の回帰テストで行う）。
--
-- 前提：0001〜0008 が適用済みであること（profiles.pro_override は 0008 で追加される）。
-- ============================================================================


-- ─── 0. 事前チェック ────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'pro_override'
  ) then
    raise exception '0009: profiles.pro_override がありません。先に 0008 を適用してください。';
  end if;
end
$$;


-- ─── 1. スキーマ ────────────────────────────────────────────────────────
-- テーブル権限があってもスキーマの USAGE が無いと参照できない。
-- Supabase では通常付与済みのため、既存環境では no-op。
grant usage on schema public to authenticated, service_role;


-- ─── 2. profiles ─────────────────────────────────────────────────────────
-- 本人の行に限定するのは profiles_select_own（0002）。
-- id は RLS の USING 句と eq('id', ...) の WHERE 句で参照されるため必要。
grant select (id, display_name, plan) on public.profiles to authenticated;

-- Pro Checkout API が「既にProか（Developer Override / Subscription由来）」を判定するため。
-- 書き込みは付与しない（課金関連の更新は SECURITY DEFINER RPC 経由のみ）。
grant select (id, plan, pro_override) on public.profiles to service_role;


-- ─── 3. projects ─────────────────────────────────────────────────────────
-- DELETE は付与しない（0005：物理DELETE禁止、soft delete のみ）。
grant select, insert on public.projects to authenticated;
grant update (name, location, start_date, end_date, deleted_at, updated_at)
  on public.projects to authenticated;


-- ─── 4. photos ───────────────────────────────────────────────────────────
-- DELETE は写真の個別削除と、現場削除時の写真削除で使う。
grant select, insert, delete on public.photos to authenticated;
grant update (sort_order, phase, folder_id, previous_folder_id, comment,
              floor, location, storage_path, updated_at)
  on public.photos to authenticated;


-- ─── 5. photo_folders ────────────────────────────────────────────────────
grant select, insert, delete on public.photo_folders to authenticated;
grant update (name, updated_at) on public.photo_folders to authenticated;


-- ─── 6. 自己検証 ─────────────────────────────────────────────────────────
-- has_*_privilege は PUBLIC やロール継承を含む実効権限を返す
-- （information_schema のような表示範囲の制限が無い）。
do $$
declare
  v_check record;
  v_actual boolean;
  v_failures text[] := array[]::text[];
begin
  for v_check in
    select *
    from (values
      -- 必要な権限があること
      ('authenticated', 'public.profiles',      'id',                       'SELECT', true),
      ('authenticated', 'public.profiles',      'display_name',             'SELECT', true),
      ('authenticated', 'public.profiles',      'plan',                     'SELECT', true),
      ('authenticated', 'public.profiles',      'display_name',             'UPDATE', true),
      ('service_role',  'public.profiles',      'id',                       'SELECT', true),
      ('service_role',  'public.profiles',      'plan',                     'SELECT', true),
      ('service_role',  'public.profiles',      'pro_override',             'SELECT', true),

      ('authenticated', 'public.projects',      null,                       'SELECT', true),
      ('authenticated', 'public.projects',      null,                       'INSERT', true),
      ('authenticated', 'public.projects',      'name',                     'UPDATE', true),
      ('authenticated', 'public.projects',      'location',                 'UPDATE', true),
      ('authenticated', 'public.projects',      'start_date',               'UPDATE', true),
      ('authenticated', 'public.projects',      'end_date',                 'UPDATE', true),
      ('authenticated', 'public.projects',      'deleted_at',               'UPDATE', true),
      ('authenticated', 'public.projects',      'updated_at',               'UPDATE', true),

      ('authenticated', 'public.photos',        null,                       'SELECT', true),
      ('authenticated', 'public.photos',        null,                       'INSERT', true),
      ('authenticated', 'public.photos',        null,                       'DELETE', true),
      ('authenticated', 'public.photos',        'sort_order',               'UPDATE', true),
      ('authenticated', 'public.photos',        'phase',                    'UPDATE', true),
      ('authenticated', 'public.photos',        'folder_id',                'UPDATE', true),
      ('authenticated', 'public.photos',        'previous_folder_id',       'UPDATE', true),
      ('authenticated', 'public.photos',        'comment',                  'UPDATE', true),
      ('authenticated', 'public.photos',        'floor',                    'UPDATE', true),
      ('authenticated', 'public.photos',        'location',                 'UPDATE', true),
      ('authenticated', 'public.photos',        'storage_path',             'UPDATE', true),
      ('authenticated', 'public.photos',        'updated_at',               'UPDATE', true),

      ('authenticated', 'public.photo_folders', null,                       'SELECT', true),
      ('authenticated', 'public.photo_folders', null,                       'INSERT', true),
      ('authenticated', 'public.photo_folders', null,                       'DELETE', true),
      ('authenticated', 'public.photo_folders', 'name',                     'UPDATE', true),
      ('authenticated', 'public.photo_folders', 'updated_at',               'UPDATE', true),

      -- 課金列をクライアントから変更できないこと（0003 / 0008）
      ('authenticated', 'public.profiles',      'plan',                     'UPDATE', false),
      ('authenticated', 'public.profiles',      'pro_override',             'UPDATE', false),
      ('authenticated', 'public.profiles',      'ads_removed_purchased_at', 'UPDATE', false),
      ('anon',          'public.profiles',      'plan',                     'UPDATE', false),
      ('anon',          'public.profiles',      'pro_override',             'UPDATE', false),
      ('anon',          'public.profiles',      'ads_removed_purchased_at', 'UPDATE', false),

      -- profiles の行をクライアントから作成・削除できないこと（0008）
      ('authenticated', 'public.profiles',      null,                       'INSERT',   false),
      ('authenticated', 'public.profiles',      null,                       'DELETE',   false),
      ('authenticated', 'public.profiles',      null,                       'TRUNCATE', false),
      ('anon',          'public.profiles',      null,                       'INSERT',   false),
      ('anon',          'public.profiles',      null,                       'DELETE',   false),
      ('anon',          'public.profiles',      null,                       'TRUNCATE', false),

      -- projects を物理DELETEできないこと（0005）
      ('authenticated', 'public.projects',      null,                       'DELETE', false),
      ('anon',          'public.projects',      null,                       'DELETE', false)
    ) as t(role_name, table_name, column_name, privilege, expected)
  loop
    if v_check.column_name is null then
      v_actual := has_table_privilege(v_check.role_name, v_check.table_name, v_check.privilege);
    else
      v_actual := has_column_privilege(
        v_check.role_name, v_check.table_name, v_check.column_name, v_check.privilege);
    end if;

    if v_actual is distinct from v_check.expected then
      v_failures := v_failures || format('%s %s %s%s: expected %s, got %s',
        v_check.role_name, v_check.privilege, v_check.table_name,
        coalesce('.' || v_check.column_name, ''), v_check.expected, v_actual);
    end if;
  end loop;

  if not has_schema_privilege('authenticated', 'public', 'USAGE') then
    v_failures := v_failures || 'authenticated USAGE on schema public: expected true, got false'::text;
  end if;
  if not has_schema_privilege('service_role', 'public', 'USAGE') then
    v_failures := v_failures || 'service_role USAGE on schema public: expected true, got false'::text;
  end if;

  if array_length(v_failures, 1) > 0 then
    raise exception '0009: 権限の自己検証に失敗しました: %', array_to_string(v_failures, '; ');
  end if;
end
$$;


-- ─── ロールバック（必要な場合のみ・手動） ──────────────────────────────
-- 本migrationは additive GRANT のみのため、取り消す場合は付与した権限だけを REVOKE する。
-- ただし production では本migration以前から同じ権限が（より広く）存在するため、
-- production で以下を実行すると既存アプリが動かなくなる。staging 専用の手順とする。
--
-- revoke update (name, updated_at) on public.photo_folders from authenticated;
-- revoke select, insert, delete on public.photo_folders from authenticated;
-- revoke update (sort_order, phase, folder_id, previous_folder_id, comment,
--                floor, location, storage_path, updated_at) on public.photos from authenticated;
-- revoke select, insert, delete on public.photos from authenticated;
-- revoke update (name, location, start_date, end_date, deleted_at, updated_at)
--   on public.projects from authenticated;
-- revoke select, insert on public.projects from authenticated;
-- revoke select (id, plan, pro_override) on public.profiles from service_role;
-- revoke select (id, display_name, plan) on public.profiles from authenticated;
