import { readFileSync, readdirSync } from 'node:fs'
import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'

// 0010（photos の所有者と工事案件の所有者の一致）の静的な確認。
// 【重要】これは SQL の「文面」の検査であり、実際の PostgreSQL では実行していない。
// 実DBでの確認は tests/sql/cases/05_photo_project_owner.sql（scripts/test-sql.sh、Docker が必要）と、
// staging での適用前チェック・適用後の確認で行う。

const ROOT = nodePath.resolve(__dirname, '../..')
const MIGRATIONS = nodePath.join(ROOT, 'supabase/migrations')
const FILE = '0010_photos_project_owner_consistency.sql'
const raw = readFileSync(nodePath.join(MIGRATIONS, FILE), 'utf8')
// 実行される部分だけ（行コメントを除く）
const executable = raw.replace(/^\s*--.*$/gm, '')
const lower = executable.toLowerCase()

describe('0010 マイグレーション（静的検証）', () => {
  it('番号は 0009 の次で、欠番・重複がない', () => {
    const names = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    const numbers = names.map((n) => Number(n.slice(0, 4)))
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
    expect(names.at(-1)).toBe(FILE)
  })

  it('複合外部キー (project_id, user_id) → projects (id, user_id) を追加し、projects に unique (id, user_id) を追加する', () => {
    expect(lower).toMatch(/add constraint projects_id_user_id_key\s+unique \(id, user_id\)/)
    expect(lower).toMatch(
      /add constraint photos_project_owner_fkey\s+foreign key \(project_id, user_id\)\s+references public\.projects \(id, user_id\)\s+on delete cascade/,
    )
  })

  it('既存データを変更しない（INSERT / UPDATE / DELETE / TRUNCATE / DROP を実行部分に含まない）', () => {
    // 先頭が文の開始になる位置だけを見る（制約名・メッセージ中の語と区別するため）
    for (const keyword of ['insert into', 'update public', 'delete from', 'truncate', 'drop ']) {
      expect(lower).not.toContain(keyword)
    }
  })

  it('不一致データがある場合は、何も変更せず例外で停止する（事前チェック）', () => {
    expect(lower).toMatch(/where not exists \(\s*select 1 from public\.projects pr\s+where pr\.id = ph\.project_id and pr\.user_id = ph\.user_id/)
    expect(lower).toMatch(/if v_mismatch > 0 then\s+raise exception/)
    // 事前チェックは、制約の追加より前にある
    expect(lower.indexOf('v_mismatch > 0')).toBeLessThan(lower.indexOf('add constraint'))
  })

  it('冪等：制約は存在を確認してから追加する', () => {
    expect(lower.match(/if not exists \(\s*select 1 from pg_constraint/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('既存の RLS ポリシー・既存の単一列の外部キーは変更しない', () => {
    expect(lower).not.toMatch(/create policy|drop policy|alter policy|enable row level security|disable row level security/)
    // 既存の単一列の外部キーを、変更・削除する文がない（存在確認の参照のみ）
    expect(lower).not.toMatch(/(drop|alter)[^;]*photos_project_id_fkey/)
  })

  it('適用前の確認用SELECT（読み取り専用）とロールバック手順を含む', () => {
    expect(raw).toContain('確認用SELECT')
    expect(raw).toMatch(/--\s+select ph\.id as photo_id/)
    expect(raw).toMatch(/--\s+alter table public\.photos\s+drop constraint if exists photos_project_owner_fkey;/)
    expect(raw).toMatch(/--\s+alter table public\.projects drop constraint if exists projects_id_user_id_key;/)
    // 確認用SELECT と ロールバックは、コメントとして書かれており実行されない
    expect(lower).not.toContain('drop constraint')
  })

  it('自己検証で、複合外部キーが検証済み（convalidated）であることを確認する', () => {
    expect(lower).toContain('convalidated')
  })

  it('実DBテスト（Docker で実行するSQLケース）が用意されている', () => {
    const cases = readdirSync(nodePath.join(ROOT, 'tests/sql/cases'))
    expect(cases).toContain('05_photo_project_owner.sql')
    const sql = readFileSync(nodePath.join(ROOT, 'tests/sql/cases/05_photo_project_owner.sql'), 'utf8')
    // 計画された 7 ケース（登録・拒否・変更・なりすまし・存在しない project_id・正常更新・管理者）
    for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.']) expect(sql).toContain(`'${n} `)
  })
})

describe('アプリの写真の書き込み経路は project_id / user_id を更新しない（0010 と衝突しない）', () => {
  const read = (file: string) => readFileSync(nodePath.join(ROOT, file), 'utf8')

  it('updateCloudPhoto は更新列を限定した型で呼ばれ、project_id / user_id を渡す呼び出しがない', () => {
    const files = [
      'src/hooks/usePhotos.ts',
      'src/hooks/usePhotoFolders.ts',
      'src/hooks/useCloudSync.ts',
    ]
    for (const f of files) {
      // 更新内容をオブジェクトで直接渡している呼び出しだけを検査する（変数 data は setFloorLocation の { floor, location }）
      const calls = read(f).match(/updateCloudPhoto\([^,()]+,\s*\{[^}]*\}\)/g) ?? []
      for (const call of calls) expect(call).not.toMatch(/project_id|user_id/)
    }
  })

  it('写真の INSERT は、所有者（ログイン中のユーザー）の工事案件にだけ行う（アップロードは owned project のみ、同期は本人の行のみ）', () => {
    expect(read('src/hooks/usePhotos.ts')).toMatch(/if \(!ownerId \|\| !ownsProject\) return newPhotos/)
    expect(read('src/hooks/useCloudSync.ts')).toMatch(/\(p\) => p\.user_id === user\.id && !cloudPhotoIds\.has\(p\.id\)/)
  })
})
