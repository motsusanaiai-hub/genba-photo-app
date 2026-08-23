-- ============================================================================
-- profiles: 3プラン化 + plan列のクライアント直接更新禁止
-- ============================================================================
-- 目的：
--   1. plan列を free / ads_removed / pro の3値に制限するCHECK制約を追加
--   2. 広告削除（買い切り）の恒久フラグ ads_removed_purchased_at を追加
--   3. authenticated / anon の「テーブル単位」UPDATE権限を剥奪したうえで、
--      自己編集を許可する display_name のみ列単位で再GRANTする。
--      （plan / ads_removed_purchased_at を含む他の列は更新不可のままになる）
--   4. profiles_update_own ポリシーの WITH CHECK を明示化
--
-- ※ 当初案（列単位REVOKEのみ）は、authenticated/anonに残っていた
--   テーブル単位UPDATE権限により実質無効だったため、テーブル単位REVOKE＋
--   列単位GRANTの構成に修正済み（詳細は4.のコメント参照）。
--
-- 対象：本番DBへ実際に適用する差分migration（baselineとは異なり、
--       このファイルは実際に supabase db push 等で適用する想定）。
--
-- 前提：
--   - 0002_profiles_baseline.sql が先に（履歴登録のみ／実DBには無適用で）
--     反映されていること
--   - 実行前に既存 plan 値が free のみであることを確認済み
--     （本移行内でも同内容を安全確認として再チェックする）
--
-- 既存ユーザーへの影響：
--   - 既存の全行は plan='free' のまま変更されない
--     （CHECK制約は"既存値の書き換え"ではなく"今後入る値の制限"であり、
--       free は許可リストに含まれるため既存行に影響しない）
--   - display_name の更新可否には影響しない（引き続きUPDATE可能）
--
-- 実行方法についての注意：
--   本ファイルはSupabase CLI（supabase db push）での適用、または
--   SQL Editorで「ファイル全体をまとめて1トランザクションとして」実行する
--   ことを推奨します。SQL Editorで手動実行する場合は、貼り付け前に
--   先頭に `begin;`、末尾に `commit;` を追加してから実行してください
--   （supabase db push は既定でmigrationごとにトランザクションを使用します）。
-- ============================================================================

-- ─── 1. 既存plan値の安全確認 ─────────────────────────────────────────────
-- free / ads_removed / pro 以外の値が既に存在する場合はここで処理を止める。
-- （実測では free のみ確認済みだが、CHECK制約追加直前に再確認する）
do $$
begin
  if exists (
    select 1
    from public.profiles
    where plan not in ('free', 'ads_removed', 'pro')
  ) then
    raise exception
      'profiles.plan に free/ads_removed/pro 以外の値が存在するため中断しました。'
      '該当行を先に確認・修正してから本migrationを再実行してください。';
  end if;
end
$$;

-- ─── 2. CHECK制約追加（plan を3値に限定） ────────────────────────────────
-- ADD CONSTRAINT には IF NOT EXISTS 相当の構文が無いため、
-- pg_constraint を見て未存在の場合のみ追加する（再実行しても安全）。
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_plan_check
      check (plan in ('free', 'ads_removed', 'pro'));
  end if;
end
$$;
-- 補足：ALTER TABLE ... ADD CONSTRAINT は既定で既存の全行を検証してから
-- 追加される（NOT VALID を付けていないため）。1.の事前チェックと合わせて
-- 二重に安全性を確保している。

-- ─── 3. 広告削除（買い切り）の恒久フラグを追加 ───────────────────────────
-- NULL = 未購入 / 日時あり = 購入済み。Pro契約・解約に関わらず書き換えない
-- 恒久情報として使用する想定（planの値とは独立して保持する）。
alter table public.profiles
  add column if not exists ads_removed_purchased_at timestamptz null;

-- ─── 4. plan / ads_removed_purchased_at のクライアント直接更新を禁止 ─────
-- 【重要・修正履歴】当初は列単位の REVOKE（revoke update (plan) ...）のみを
-- 主防御としていたが、実測により public.profiles には authenticated / anon
-- に対して「テーブル単位」のUPDATE権限が別途付与されていることが判明した。
--
-- PostgreSQLの権限モデルでは、テーブル単位UPDATE権限と列単位UPDATE権限は
-- 独立したACLエントリであり、実際に許可される操作は「どちらか一方でも
-- 許可していれば可」という加算（論理OR）で判定される。そのため、
-- テーブル単位のUPDATE権限が残ったまま列単位のREVOKEだけを行っても、
-- テーブル単位の権限が独立に全列（plan列を含む）への更新を許可し続けるため
-- 実際には更新を防げない。これは列単位REVOKEでは"上書き"できない。
--
-- 正しい対処：authenticated / anon の「テーブル単位」UPDATE権限を完全に
-- 剥奪したうえで、自己編集を許可してよい列（display_name）だけを
-- 列単位で個別にGRANTし直す。

-- authenticated / anon のテーブル単位UPDATE権限を完全に剥奪
-- （postgres / service_role のテーブル単位UPDATE権限には触れない。
--   service_role は将来のStripe/ストア課金Webhook・管理者処理からの
--   plan / ads_removed_purchased_at 更新に必要なため維持する）
revoke update on public.profiles from authenticated, anon;

-- 自己編集を許可してよい列のみ、列単位で個別に付与し直す。
-- plan / ads_removed_purchased_at / id / created_at / updated_at は
-- 意図的にここでGRANTしない（authenticated/anonからは更新不可のまま）。
grant update (display_name) on public.profiles to authenticated;
-- anon には自己編集対象の行が存在しないため、列単位GRANTも一切付与しない。

-- 上記のテーブル単位REVOKEが主防御（かつ唯一の有効な防御）。以下は
-- 将来誰かが誤ってテーブル単位のUPDATE権限を復活させてしまった場合に
-- 備えた明示的な意図表明であり、単独では効果を持たない点に注意
-- （テーブル単位の権限が復活すれば、この列単位REVOKEでは防げない）。
revoke update (plan) on public.profiles from authenticated, anon;
revoke update (ads_removed_purchased_at) on public.profiles from authenticated, anon;

-- ─── 5. profiles_update_own ポリシーの WITH CHECK を明示化 ──────────────
-- 挙動は実質変わらない（省略時はUSING句が暗黙的にWITH CHECKにも
-- 使われるため）が、意図を明文化する。
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ─── 6. plan変更防止トリガーについて（今回は追加しない） ─────────────────
-- 上記4のREVOKEを主防御として採用し、本migrationではトリガーは追加しない。
-- 理由は本migrationとは別に報告済み（auth.role()のservice_role判定を
-- 本番実測していないため、未検証の防御層を追加するより、検証済みの
-- REVOKEのみで完結させる方が安全と判断）。将来service_role経由の
-- plan更新パス（Webhook/RPC）を実装するタイミングで、その検証と合わせて
-- 別migrationとして追加を再検討する。

-- ============================================================================
-- ロールバック用SQL（参考・コメントアウトのため実行されない）
-- ============================================================================
-- 本番適用後に問題が見つかった場合、以下を新規migration（例：0004）として
-- 切り出して実行することを想定した参考SQL。このファイル内では実行されない。
--
-- -- 5.の巻き戻し（WITH CHECK明示化以前の状態へ）
-- drop policy if exists "profiles_update_own" on public.profiles;
-- create policy "profiles_update_own"
--   on public.profiles
--   for update
--   using (auth.uid() = id);
--
-- -- 4.の巻き戻し（実測時の状態＝テーブル単位UPDATE権限ありへ戻す）
-- revoke update (display_name) on public.profiles from authenticated;
-- grant update on public.profiles to authenticated, anon;
--
-- -- 3.の巻き戻し（列削除。データも失われるため実施は慎重に）
-- alter table public.profiles drop column if exists ads_removed_purchased_at;
--
-- -- 2.の巻き戻し（CHECK制約削除）
-- alter table public.profiles drop constraint if exists profiles_plan_check;
-- ============================================================================
