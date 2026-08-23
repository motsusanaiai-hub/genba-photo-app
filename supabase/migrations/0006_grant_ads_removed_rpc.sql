-- ============================================================================
-- 広告削除（買い切り300円）決済確定用RPC: public.grant_ads_removed
-- ============================================================================
-- 目的：
--   Stripe Webhook（Vercel Function、service_roleクライアント経由）から
--   のみ呼び出される、広告削除決済確定処理をDB側に集約する。
--
--   決済ルール（Webhook側に業務ロジックを書き散らさないため、ここに集約する）：
--     - ads_removed_purchased_at が NULL のときのみ now() を設定する
--       （既に値がある場合は上書きしない＝再購入・Webhook再送でも
--        最初の購入日時が保持される）
--     - plan = 'free'        → 'ads_removed' に変更
--     - plan = 'ads_removed' → そのまま（変更なし）
--     - plan = 'pro'         → そのまま（Proを広告削除購入で降格させない）
--     - updated_at を更新する
--     - 対象ユーザーが存在しない場合は例外を送出し、安全に失敗する
--       （中途半端な更新を残さない。呼び出し元のトランザクションは
--        ロールバックされる）
--
-- 権限：
--   SECURITY DEFINER + search_path固定（public）で実行する。
--   authenticated / anon には EXECUTE 権限を一切与えない
--   （クライアントから直接呼び出せない）。
--   service_role のみ EXECUTE 可能（Webhookからの呼び出し専用）。
--   postgres（テーブル所有者・スーパーユーザー相当）は権限確認の対象外のため
--   個別GRANTは不要。
--
-- 適用対象：本番DBへ実際に適用する差分migration。
--   ※ このファイル自体は今回まだ本番へは適用しない（コード上の準備のみ）。
--
-- 前提：
--   - 0001〜0005 が適用済みであること
--     （profiles.plan / profiles.ads_removed_purchased_at が存在すること）
-- ============================================================================

-- ─── 1. RPC本体 ─────────────────────────────────────────────────────────
create or replace function public.grant_ads_removed(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.profiles
  set
    ads_removed_purchased_at = coalesce(ads_removed_purchased_at, now()),
    plan = case
      when plan = 'free' then 'ads_removed'
      else plan
    end,
    updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception
      'grant_ads_removed: user % に対応する profiles 行が見つかりません', target_user_id;
  end if;
end;
$function$;

-- ─── 2. 実行権限：service_roleのみに限定 ───────────────────────────────
-- 新規関数は既定でPUBLICにEXECUTE権限が付与されるため、まず明示的に剥奪する
-- （PUBLIC経由でauthenticated/anonが実行できる状態を残さないため）。
revoke execute on function public.grant_ads_removed(uuid) from public;
revoke execute on function public.grant_ads_removed(uuid) from authenticated;
revoke execute on function public.grant_ads_removed(uuid) from anon;

grant execute on function public.grant_ads_removed(uuid) to service_role;

-- ============================================================================
-- ロールバック用SQL（参考・コメントアウトのため実行されない）
-- ============================================================================
-- drop function if exists public.grant_ads_removed(uuid);
-- ============================================================================
