-- ============================================================================
-- SQLテスト用の準備（使い捨てのPostgreSQLコンテナ専用）
-- ============================================================================
-- 0001〜0009 が前提にしている Supabase の部品だけを最小限で用意する。
--   - ロール：anon / authenticated / service_role（service_role は BYPASSRLS）
--   - auth スキーマ：auth.users（0002 のトリガーが読む列のみ）、auth.uid()
--   - storage スキーマ：buckets / objects / foldername()（0001 のバケット登録とポリシー用）
-- Supabase の完全な再現ではない（認証サービス・ストレージサービスの実体は無い）。
-- 本番・Staging の Supabase には絶対に実行しないこと（scripts/test-sql.sh からのみ使う）。
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Supabase と同じく、APIロールは public スキーマを参照できる。
grant usage on schema public to anon, authenticated, service_role;

-- ─── auth ───────────────────────────────────────────────────────────────
create schema auth;

create table auth.users (
  id                 uuid        primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase の auth.uid() と同じ読み取り方（request.jwt.claim.sub / request.jwt.claims の sub）。
create function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$function$;

-- RLSポリシーの評価はクエリを実行したロールの権限で行われるため、APIロールに参照を許可する。
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ─── storage ────────────────────────────────────────────────────────────
create schema storage;

create table storage.buckets (
  id     text    primary key,
  name   text    not null,
  public boolean not null default false
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text,
  owner     uuid
);

alter table storage.objects enable row level security;

-- 'uid/xxx/file.jpg' → {uid, xxx}（Supabase の storage.foldername と同じ結果）
create function storage.foldername(name text)
returns text[]
language sql
immutable
as $function$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$function$;

grant usage on schema storage to anon, authenticated, service_role;
