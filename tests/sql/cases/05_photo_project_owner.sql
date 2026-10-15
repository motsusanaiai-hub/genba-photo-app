-- ============================================================================
-- 05：写真の所有者と工事案件の所有者の一致（0010 複合外部キー）
--   scripts/test-sql.sh（使い捨ての PostgreSQL コンテナ）で実行する。
--   GRANT / RLS / 外部キーの拒否は、SQLSTATE とメッセージで区別する：
--     RLS による拒否        … 42501 'new row violates row-level security policy ...'
--     GRANT による拒否      … 42501 'permission denied for ...'（new モードでは project_id の UPDATE 権限が無い）
--     外部キーによる拒否    … 23503 'insert or update on table "photos" violates foreign key constraint ...'
-- ============================================================================

do $$
declare
  t_a uuid := test_helpers.create_user('owner-a@example.com');
  t_b uuid := test_helpers.create_user('owner-b@example.com');
  v_project_a uuid;
  v_project_b uuid;
  v_own_photo uuid := gen_random_uuid();
  v_state text;
  v_before bigint;
begin
  v_project_a := test_helpers.create_project_data(t_a);
  v_project_b := test_helpers.create_project_data(t_b);

  perform test_helpers.assert_true(
    exists (select 1 from pg_constraint where conname = 'photos_project_owner_fkey' and convalidated),
    '[0010] photos_project_owner_fkey が検証済みで存在する');

  perform test_helpers.as_user(t_a);

  -- 1. Aの写真をAの工事案件へ登録 → 許可
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format(
      'insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      v_own_photo, v_project_a, t_a, 'own.jpg'))::text,
    '1', '1. Aの写真をAの工事案件へ登録できる');

  -- 2. Aの写真をBの工事案件へ登録 → 拒否（RLS は通るが、外部キーが拒否する）
  perform test_helpers.expect_error(
    format('insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      gen_random_uuid(), v_project_b, t_a, 'to-b.jpg'),
    '23503', 'insert or update on table "photos" violates foreign key constraint%',
    '2. Aの写真をBの工事案件へ登録できない');

  -- 3. Aの写真をBの工事案件へ変更 → 拒否（new: 列権限なし 42501 / legacy: 外部キー 23503）
  v_state := null;
  begin
    execute format('update public.photos set project_id = %L where id = %L', v_project_b, v_own_photo);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform test_helpers.assert_true(v_state in ('42501', '23503'),
    '3. Aの写真をBの工事案件へ変更できない（SQLSTATE=' || coalesce(v_state, 'なし') || '）');

  -- 4. BがA名義の写真を登録 → 拒否（RLS）
  perform test_helpers.as_user(t_b);
  perform test_helpers.expect_error(
    format('insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      gen_random_uuid(), v_project_a, t_a, 'spoof.jpg'),
    '42501', 'new row violates row-level security policy%',
    '4. BはA名義の写真を登録できない');
  -- BがBの名義で、Aの工事案件へ登録 → 拒否（外部キー）
  perform test_helpers.expect_error(
    format('insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      gen_random_uuid(), v_project_a, t_b, 'to-a.jpg'),
    '23503', 'insert or update on table "photos" violates foreign key constraint%',
    '4. BはB名義でもAの工事案件へ写真を登録できない');

  -- 5. 存在しない project_id → 拒否
  perform test_helpers.as_user(t_a);
  perform test_helpers.expect_error(
    format('insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      gen_random_uuid(), gen_random_uuid(), t_a, 'ghost.jpg'),
    '23503', 'insert or update on table "photos" violates foreign key constraint%',
    '5. 存在しない project_id の写真は登録できない');

  -- 6. 正常な写真の更新 → 許可（アプリが更新する列）
  perform test_helpers.assert_eq(
    test_helpers.rows_affected(format(
      'update public.photos set comment = %L, sort_order = 5, phase = %L, updated_at = now() where id = %L',
      '更新', 'before', v_own_photo))::text,
    '1', '6. 正常な写真の更新（comment / sort_order / phase）ができる');

  -- 7. 制約はロールに関係なく効く（管理者でも、他人の工事案件へ写真を登録できない）
  perform test_helpers.as_admin();
  perform test_helpers.expect_error(
    format('insert into public.photos (id, project_id, user_id, original_filename) values (%L, %L, %L, %L)',
      gen_random_uuid(), v_project_b, t_a, 'admin-cross.jpg'),
    '23503', 'insert or update on table "photos" violates foreign key constraint%',
    '7. 管理者ロールでも、他人の工事案件へ写真を登録できない');

  -- 8. 工事案件の物理削除で、紐づく写真も消える（cascade の維持）
  select count(*) into v_before from public.photos where project_id = v_project_a;
  perform test_helpers.assert_true(v_before >= 3, '8. 削除前に写真がある');
  delete from public.projects where id = v_project_a;
  perform test_helpers.assert_eq(
    (select count(*) from public.photos where project_id = v_project_a)::text,
    '0', '8. 工事案件を物理削除すると写真も削除される（on delete cascade）');
  perform test_helpers.assert_true(
    (select count(*) = 2 from public.photos where project_id = v_project_b),
    '8. 他人の工事案件の写真は削除されていない');
end
$$;
