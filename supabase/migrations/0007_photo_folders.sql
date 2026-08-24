-- ============================================================================
-- 未分類フォルダ機能: photo_folders テーブル新設 + photos.folder_id 追加
-- ============================================================================
-- 目的：
--   未分類タブ内で写真を「5階天井貼替」「6階トイレ」のような工種・部屋単位の
--   フォルダへ整理できるようにする。フォルダはあくまで未分類写真の整理専用で、
--   施工前/施工中/施工後のフェーズ管理とは独立した概念として扱う。
--
-- 対象：本番DBへ実際に適用する差分migration。
--   ※ このファイル自体は今回まだ本番へは適用しない（コード上の準備のみ）。
--   適用（supabase db push 等）は開発者が別途判断して実行すること。
--
-- 既存データへの影響：
--   - photo_folders は新規テーブルのため既存データへの影響なし。
--   - photos.folder_id は nullable列の追加のみ。既存の全写真行は
--     folder_id = null（＝フォルダなし・未分類直下）のまま変更されない。
--   - 旧アプリ（本migration適用時点でまだ稼働中の可能性があるコード）は
--     folder_id 列の存在を一切参照しないため、この段階の適用だけでは
--     旧アプリの挙動は何も変わらない。
--
-- デプロイ順序：
--   0004/0005の教訓（projects物理DELETE禁止化）と異なり、今回は権限の
--   REVOKE等を伴わない「追加のみ」のmigrationのため、マイグレーション適用と
--   アプリデプロイのどちらが先でも既存機能は壊れない
--   （マイグレーション未適用の状態でアプリだけ先にデプロイされた場合、
--    folder_id列が無くフォルダ機能のクラウド同期が失敗するだけで、
--    フェーズ管理・写真表示等の既存機能には影響しない設計としている）。
--   念のため、マイグレーション適用 → アプリデプロイ の順を推奨する。
--
-- previous_folder_id について：
--   未分類フォルダ内の写真を施工前/中/後へ分類すると folder_id は null に
--   戻すが、その直前の folder_id をここへ退避しておき、未分類へ戻す際に
--   元のフォルダへ自動復帰させるために使う（元フォルダが削除済みの場合は
--   復帰させず未分類直下へ戻す）。folder_id と同様 on delete set null と
--   するため、フォルダ削除時はこちらも自動的にnullへ戻り、復帰先を
--   誤って参照し続けることがない。
--
-- parent_folder_id（階層フォルダ）について：
--   「6階 > 外部」のような階層をWindows側のフォルダ構成そのまま再現できるよう、
--   photo_folders自身を自己参照するparent_folder_idを持つ。nullはトップレベル
--   （未分類フォルダ一覧の直下）を意味する。
--   親フォルダを削除した場合は on delete cascade により子孫フォルダの行も
--   自動的に連鎖削除される（Postgresの自己参照FKは多段階層でも正しく連鎖する）。
--   ただし写真（photos）は folder_id が on delete set null のため、
--   祖先フォルダのどれかが削除されても写真自体が消えることはなく、
--   未分類直下（folder_id=null）へ落ちるだけになる（写真保護仕様は維持）。
--
-- 将来の拡張について（今回は追加しない。設計メモとして残す）：
--   - default_floor / default_location / default_work_type
--     （工事看板の初期値用）は、後からnullable列を追加するだけで対応できる。
-- ============================================================================

-- ─── photo_folders ──────────────────────────────────────────────────────
create table public.photo_folders (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- photos/projectsと同様、RLSを auth.uid() = user_id という単純な等価比較で
  -- 書けるようにするため、project_id経由のサブクエリではなくuser_idを冗長に持つ。
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index photo_folders_project_id_idx on public.photo_folders(project_id);

alter table public.photo_folders enable row level security;
create policy "photo_folders_select_own" on public.photo_folders for select using (auth.uid() = user_id);
create policy "photo_folders_insert_own" on public.photo_folders for insert with check (auth.uid() = user_id);
create policy "photo_folders_update_own" on public.photo_folders for update using (auth.uid() = user_id);
create policy "photo_folders_delete_own" on public.photo_folders for delete using (auth.uid() = user_id);

-- ─── photo_folders.parent_folder_id（階層化） ────────────────────────────
-- 自己参照。null=トップレベル。alter/add columnにしているのは、このファイルが
-- 万一既に（parent_folder_id無しの状態で）適用済みだった場合でも安全に
-- 再適用できるようにするため（if not existsのため実害なく冪等）。
alter table public.photo_folders
  add column if not exists parent_folder_id uuid references public.photo_folders(id) on delete cascade;
create index if not exists photo_folders_parent_folder_id_idx on public.photo_folders(parent_folder_id);

-- ─── photos.folder_id ───────────────────────────────────────────────────
-- on delete set null により、フォルダ削除時は写真自体を消さずfolder_idだけ
-- 自動的にnullへ戻す（＝未分類直下へ戻る）。アプリ側で個別にnull更新する
-- 必要がなく、DB側で確実に整合性が取れる。
alter table public.photos
  add column if not exists folder_id uuid references public.photo_folders(id) on delete set null;
create index if not exists photos_folder_id_idx on public.photos(folder_id);

-- ─── photos.previous_folder_id ──────────────────────────────────────────
alter table public.photos
  add column if not exists previous_folder_id uuid references public.photo_folders(id) on delete set null;
create index if not exists photos_previous_folder_id_idx on public.photos(previous_folder_id);
