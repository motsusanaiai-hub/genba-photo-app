-- ============================================================================
-- projects: soft delete用の deleted_at 列を追加（後方互換migration）
-- ============================================================================
-- 目的：
--   現場削除を「projects物理DELETE」から「deleted_at設定によるsoft delete」に
--   移行するための最初の段階。この段階では列とインデックスの追加のみを行い、
--   物理DELETE権限のREVOKEは含めない。
--
--   背景（不具合の再発防止）：
--   これまではprojects削除時に物理DELETEしていたため、削除の事実がどこにも
--   残らなかった。その結果、別端末・別ブラウザ（別オリジンのlocalStorage）に
--   削除前の古いprojectがローカルに残っていると、useCloudSyncが
--   「クラウドに無い＝未同期の新規project」と誤判定し、削除済みprojectを
--   Supabaseへ再INSERTしてしまう不具合が実際に発生した（現場「テスト」）。
--
--   deleted_atを追加し、削除済みprojectのidも「クラウドが過去に認識した
--   id」として保持し続けることで、この誤判定を防ぐ。
--
-- 【重要：デプロイ順序上、物理DELETE権限のREVOKEをここに含めない理由】
--   本番へは「0004適用 → アプリコードデプロイ」の順で反映する。
--   0004適用直後〜新アプリデプロイ完了までの間、本番では旧アプリ（現場削除時に
--   projectsを物理DELETEする実装）がまだ稼働している。もしこの0004で
--   物理DELETE権限を先にREVOKEしてしまうと、その間は現場削除操作が権限
--   エラーで失敗してしまう。そのため、物理DELETE権限のREVOKEは新アプリの
--   動作確認が終わったあとに別migration（0005_projects_disable_physical_delete.sql）
--   として適用し、後方互換性を保つ。
--
-- 対象：本番DBへ実際に適用する差分migration（今回はまだ適用しない）。
--
-- 既存ユーザーへの影響：
--   既存の全projects行は deleted_at が NULL（＝有効）のまま変更されない。
--   nullable列の追加のみのため、後方互換性への影響はない。
--   旧アプリ（本migration適用時点でまだ稼働中の現行コード）は deleted_at
--   列の存在を一切参照しないため、この段階の適用だけでは旧アプリの
--   挙動は何も変わらない（引き続き物理DELETEで現場削除が動作する）。
-- ============================================================================

-- ─── 1. deleted_at列を追加 ────────────────────────────────────────────
alter table public.projects
  add column if not exists deleted_at timestamptz null;

-- ─── 2. 有効なprojectの一覧・件数カウントを効率化する部分インデックス ───
create index if not exists projects_user_active_idx
  on public.projects (user_id)
  where deleted_at is null;

-- ─── RLSについて ─────────────────────────────────────────────────────
-- 既存の projects_select_own / projects_update_own / projects_delete_own
-- （0001で定義済み、いずれも auth.uid() = user_id）は変更しない。
-- 物理DELETE権限のREVOKEは 0005 で別途行う。
