-- ============================================================================
-- profiles baseline migration
-- ============================================================================
-- 目的：
--   本番Supabase環境に既に存在している public.profiles 関連の構造を、
--   Gitのmigration履歴上でも再現できるようにするための「ベースライン」ファイル。
--
-- 実測日：2026-08-23 時点の本番DBをSQL Editorから読み取り専用で確認した内容を反映。
--
-- ⚠️ 重要：このファイルは本番DBには実行しないでください。
--   本番には既に同一の構造（テーブル・制約・RLS・トリガー）が存在しています。
--   このまま本番へ適用すると、CREATE TABLE / CREATE POLICY / CREATE TRIGGER が
--   いずれも「既に存在する」ことを理由にエラーになります
--   （CREATE TABLE IF NOT EXISTS のみ静かに成功しますが、その中の
--    PRIMARY KEY / FOREIGN KEY 制約句も含めて丸ごとスキップされるため、
--    本番へ実行しても実害はありませんが、意図的な操作ではありません）。
--
--   このファイルの想定用途は次の2つです：
--     1. `supabase db pull` 等でmigration履歴テーブルへ
--        「既に適用済み」として登録する（実際のDDLは走らない）
--     2. ローカル/ステージング等、profiles が存在しない「まっさらな環境」で
--        この構造を最初から再現する
--
--   本番への `supabase db push` や、SQL Editorでのこのファイルの直接実行は
--   行わないでください。
-- ============================================================================

-- ─── public.profiles テーブル ───────────────────────────────────────────
-- カラム構成・PRIMARY KEY・FOREIGN KEY (ON DELETE CASCADE) は実測結果通り。
create table if not exists public.profiles (
  id           uuid        not null,
  display_name text        not null,
  plan         text        not null default 'free'::text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id)
    references auth.users (id) on delete cascade
);

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- 実測時点では自分の行のみ参照可能。INSERT/DELETEポリシーは存在しない
-- （新規行の作成は下記 handle_new_user() が SECURITY DEFINER で行うため、
--   authenticated/anon 向けのINSERTポリシーは不要かつ意図的に存在しない）。
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- 実測時点の with_check は NULL（未設定）。挙動の明示化は 0003 で行う。
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id);

-- ─── auth.users → profiles 自動作成 ──────────────────────────────────────
-- 新規サインアップ時、auth.users への INSERT を契機に public.profiles の
-- 行を自動作成する。display_name は raw_user_meta_data 優先、無ければ
-- メールアドレスのローカルパートを使用。plan は明示せず、列のDEFAULT
-- （'free'）に委ねる。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  );

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
