-- ============================================================================
-- legacy モード（本番相当）：public スキーマの新規オブジェクトに
-- anon / authenticated / service_role へ ALL を自動付与する Supabase の旧挙動を再現する。
-- bootstrap.sql の後、Migration の前に適用する。
-- new モード（Staging相当：自動付与なし）では適用しない。
-- ============================================================================

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
