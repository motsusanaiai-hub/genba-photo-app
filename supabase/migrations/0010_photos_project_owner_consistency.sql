-- ============================================================================
-- photos: 写真の所有者と、所属する工事案件の所有者を必ず一致させる（複合外部キー）
-- ============================================================================
-- 背景：
--   photos の RLS（0001）は auth.uid() = user_id だけを見ており、project_id が
--   「誰の工事案件か」を確認していない。そのため、他人の project_id を指す写真行
--   （user_id は自分）を INSERT できてしまう。
--   （photo_folders は 0007 で insert/update の with check に exists(...) を足しているが、
--    photos には同様の確認が無い。）
--
-- 方式：複合外部キー
--   projects に unique (id, user_id) を追加し、photos (project_id, user_id) から
--   projects (id, user_id) を参照する外部キーを追加する。
--     - INSERT でも UPDATE でも、(project_id, user_id) の組が projects に実在することが
--       データベース自身によって保証される（他人の工事案件・存在しない工事案件は 23503 で拒否）。
--     - RLS ではなく制約のため、ロールに関係なく（service_role・postgres を含めて）効く。
--       RLS の PERMISSIVE ポリシーが OR で評価されることや、既存の広いポリシー・
--       本番に残る広い権限（legacy ACL）の影響を受けない。
--     - 0007 の photo_folders (id, project_id) 複合unique と同じ手法。
--   既存の単一列の外部キー photos_project_id_fkey（on delete cascade）はそのまま残す。
--   photos の RLS ポリシーは変更しない（動作の互換性を保つため）。
--
-- 既存データ：
--   既存の行は一切変更・削除しない。所有者が一致しない既存行がある場合、この migration は
--   【何も変更せずに】例外で停止する（下の「0. 事前チェック」）。その場合は、先に
--   docs の確認用SELECT（本ファイル末尾のコメント）で該当行を調べ、手動で対処してから再実行する。
--
-- 冪等性：
--   制約は存在を確認してから追加するため、再実行しても重複しない。
--
-- 適用前の確認事項（staging / production とも）：
--   1. 本ファイル末尾の「確認用SELECT」で、不一致が 0 件であること。
--   2. 0001〜0009 が適用済みであること（photos / projects / photo_folders）。
--   3. 影響する書き込み経路：写真の INSERT（アップロード・同期の backfill）と、
--      photos の project_id / user_id の UPDATE。アプリは project_id・user_id を UPDATE しない
--      （src/lib/cloudSync.ts の updateCloudPhoto は sort_order / phase / folder / comment /
--       floor / location / storage_path のみ）。通常の登録・同期は、本人の工事案件にだけ行うため影響しない。
--   4. production へは、staging での検証と明示的な承認の後に適用する。
--
-- 注意：
--   projects.user_id を変更すると、写真が参照している間は外部キー違反になる
--   （工事案件の所有者を後から変える操作を、写真がある限り禁止する効果もある）。
--   アプリは projects.user_id を UPDATE しない（0009 の列権限にも含まれない）。
-- ============================================================================


-- ─── 0. 事前チェック（データは変更しない） ─────────────────────────────────
do $$
declare
  v_mismatch bigint;
begin
  if to_regclass('public.photos') is null or to_regclass('public.projects') is null then
    raise exception '0010: photos / projects がありません。先に 0001 を適用してください。';
  end if;

  select count(*) into v_mismatch
  from public.photos ph
  where not exists (
    select 1 from public.projects pr
    where pr.id = ph.project_id and pr.user_id = ph.user_id
  );

  if v_mismatch > 0 then
    raise exception
      '0010: 写真と工事案件の所有者が一致しない（または工事案件が存在しない）写真が % 件あります。'
      ' 何も変更せず中止しました。本ファイル末尾の確認用SELECTで該当行を調べ、手動で対処してから再実行してください。',
      v_mismatch;
  end if;
end
$$;


-- ─── 1. projects (id, user_id) の unique（複合外部キーの参照先） ───────────────
-- id は主キーのため、(id, user_id) の unique は常に成立する（既存データで失敗しない）。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_id_user_id_key'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_id_user_id_key unique (id, user_id);
  end if;
end
$$;


-- ─── 2. photos (project_id, user_id) → projects (id, user_id) ────────────────
-- on delete cascade：工事案件を（service_role 等で）物理削除したとき、写真も消える
-- 既存の photos_project_id_fkey と同じ挙動。on update は既定（no action）。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'photos_project_owner_fkey'
      and conrelid = 'public.photos'::regclass
  ) then
    alter table public.photos
      add constraint photos_project_owner_fkey
      foreign key (project_id, user_id)
      references public.projects (id, user_id)
      on delete cascade;
  end if;
end
$$;


-- ─── 3. 自己検証 ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_id_user_id_key' and conrelid = 'public.projects'::regclass and contype = 'u'
  ) then
    raise exception '0010: projects_id_user_id_key がありません';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'photos_project_owner_fkey' and conrelid = 'public.photos'::regclass
      and contype = 'f' and convalidated
  ) then
    raise exception '0010: photos_project_owner_fkey がない、または検証済みではありません';
  end if;

  -- 既存の単一列の外部キーは残っていること（変更していない）
  if not exists (
    select 1 from pg_constraint
    where conname = 'photos_project_id_fkey' and conrelid = 'public.photos'::regclass and contype = 'f'
  ) then
    raise notice '0010: photos_project_id_fkey は別名、または存在しません（この migration は触れていません）';
  end if;
end
$$;


-- ─── 確認用SELECT（読み取り専用・適用前に実行して結果を確認する） ──────────────
-- 実行しても何も変更しない。0 件であれば、この migration は事前チェックを通過する。
--
-- (a) 所有者が一致しない写真 ＝ 他人の工事案件を指す写真
--   select ph.id as photo_id, ph.user_id as photo_user_id, ph.project_id,
--          pr.user_id as project_user_id, pr.deleted_at as project_deleted_at
--   from public.photos ph
--   join public.projects pr on pr.id = ph.project_id
--   where pr.user_id <> ph.user_id;
--
-- (b) 工事案件が存在しない写真（通常は外部キーにより存在しない）
--   select ph.id as photo_id, ph.user_id, ph.project_id
--   from public.photos ph
--   left join public.projects pr on pr.id = ph.project_id
--   where pr.id is null;
--
-- (c) 合計（0 であること）
--   select count(*) as mismatched_photos
--   from public.photos ph
--   where not exists (select 1 from public.projects pr
--                     where pr.id = ph.project_id and pr.user_id = ph.user_id);
--
-- NULL の扱い：photos.project_id / user_id、projects.user_id は not null のため、NULL は存在しない。
-- 削除済み工事案件（projects.deleted_at が設定済み）：所有者が一致していれば不一致ではない（対象外）。
-- 不一致が見つかった場合の対処案（自動では実行しない）：
--   - 誤って他人の工事案件に紐づいた写真：内容を確認のうえ、正しい工事案件へ付け替える、または削除する。
--   - どちらが正しいか不明な場合：削除せず、まず該当 id を控えて調査する。


-- ─── ロールバック（必要な場合のみ・手動） ──────────────────────────────────
-- 追加した制約だけを外す。データは変更されない。外すと、他人の工事案件を指す写真行が
-- 再び登録できる状態に戻る（セキュリティ上の後退）。
--
-- alter table public.photos   drop constraint if exists photos_project_owner_fkey;
-- alter table public.projects drop constraint if exists projects_id_user_id_key;
--
-- （photos_project_owner_fkey を先に外す。projects_id_user_id_key は、それを参照している間は外せない。）
