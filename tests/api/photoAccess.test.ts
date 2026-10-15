import { describe, expect, it } from 'vitest'
import {
  PHOTO_ACCESS_DENIED_MESSAGE,
  PHOTO_UNSYNCED_MESSAGE,
  expectedStoragePath,
  validatePhotoAccess,
} from '../../api/_lib/photoAccess'

// 署名付きURLを発行する前の認可ロジック（純粋関数）。外部サービスには接続しない。

const USER = '11111111-1111-4111-8111-1111111111ab'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PHOTO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PHOTO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PROJECT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const photo = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: USER,
  project_id: PROJECT,
  storage_path: expectedStoragePath(USER, id),
  ...overrides,
})
const project = (id = PROJECT, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: USER,
  deleted_at: null,
  ...overrides,
})

function check(
  photoRows: unknown[] | null,
  projectRows: unknown[] | null = [project()],
  requestedPhotoIds: string[] = [PHOTO_A],
  userId = USER,
) {
  return validatePhotoAccess({ userId, requestedPhotoIds, photoRows, projectRows })
}

describe('正常系', () => {
  it('本人の写真・本人の工事案件・正しい storage_path なら許可し、検証済みのパスを返す', () => {
    const result = check([photo(PHOTO_A)])
    expect(result).toEqual({ ok: true, photos: [{ id: PHOTO_A, storagePath: `${USER}/${PHOTO_A}.jpg` }] })
  })

  it('複数写真（別々の工事案件に属していても、すべて本人のもの）を許可する', () => {
    const result = check(
      [photo(PHOTO_A), photo(PHOTO_B, { project_id: OTHER_PROJECT })],
      [project(), project(OTHER_PROJECT)],
      [PHOTO_A, PHOTO_B],
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.photos.map((p) => p.id)).toEqual([PHOTO_A, PHOTO_B])
  })

  it('保存パスの規則は、アップロード処理（ユーザーID/写真ID.jpg）と同じ', () => {
    expect(expectedStoragePath(USER, PHOTO_A)).toBe(`${USER}/${PHOTO_A}.jpg`)
  })
})

describe('異常系：所有者・工事案件', () => {
  it('取得できた写真が要求より少ない（他ユーザー・存在しない写真が混ざっている）→ 403', () => {
    const result = check([photo(PHOTO_A)], [project()], [PHOTO_A, PHOTO_B])
    expect(result).toMatchObject({ ok: false, status: 403, error: PHOTO_ACCESS_DENIED_MESSAGE })
  })

  it('写真の user_id が本人でない行が返ってきても拒否する（RLSに頼り切らない）', () => {
    const result = check([photo(PHOTO_A, { user_id: OTHER_USER })])
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'photo_not_accessible' })
  })

  it('要求していない写真IDの行が混ざっていたら拒否する', () => {
    const result = check([photo(PHOTO_B)], [project()], [PHOTO_A])
    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it('同じ写真の行が重複していたら拒否する', () => {
    const result = check([photo(PHOTO_A), photo(PHOTO_A)], [project()], [PHOTO_A, PHOTO_B])
    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it('他ユーザーの工事案件を指す写真（工事案件が本人の分として取得できない）→ 403', () => {
    const result = check([photo(PHOTO_A, { project_id: OTHER_PROJECT })], [project()])
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'project_not_accessible' })
  })

  it('工事案件の user_id が本人でない行が返ってきても拒否する', () => {
    const result = check([photo(PHOTO_A)], [project(PROJECT, { user_id: OTHER_USER })])
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'project_not_accessible' })
  })

  it('削除済み（deleted_at あり）の工事案件 → 403', () => {
    const result = check([photo(PHOTO_A)], [project(PROJECT, { deleted_at: '2026-10-01T00:00:00Z' })])
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'project_deleted' })
  })

  it('project_id が無い・工事案件が1件も取得できない → 403', () => {
    expect(check([photo(PHOTO_A, { project_id: null })])).toMatchObject({ ok: false, status: 403 })
    expect(check([photo(PHOTO_A)], [])).toMatchObject({ ok: false, status: 403 })
    expect(check([photo(PHOTO_A)], null)).toMatchObject({ ok: false, status: 403 })
  })

  it('認証ユーザーIDが空なら拒否する', () => {
    expect(check([photo(PHOTO_A)], [project()], [PHOTO_A], '')).toMatchObject({ ok: false, status: 403 })
  })
})

describe('異常系：storage_path', () => {
  it.each([
    ['null', null],
    ['空文字', ''],
    ['空白のみ', '   '],
    ['未設定（undefined）', undefined],
  ])('storage_path が %s → 同期未完了として 409', (_label, value) => {
    const result = check([photo(PHOTO_A, { storage_path: value })])
    expect(result).toMatchObject({ ok: false, status: 409, error: PHOTO_UNSYNCED_MESSAGE })
  })

  it('1枚でも未同期なら、他の写真が正常でも全体を 409（部分成功にしない）', () => {
    const result = check([photo(PHOTO_A), photo(PHOTO_B, { storage_path: null })], [project()], [PHOTO_A, PHOTO_B])
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it.each([
    ['他ユーザーのフォルダ', `${OTHER_USER}/${PHOTO_A}.jpg`],
    ['他の写真IDのパス', `${USER}/${PHOTO_B}.jpg`],
    ['他ユーザーかつ他の写真ID', `${OTHER_USER}/${PHOTO_B}.jpg`],
    ['拡張子が違う（.png）', `${USER}/${PHOTO_A}.png`],
    ['拡張子が大文字（.JPG）', `${USER}/${PHOTO_A}.JPG`],
    ['拡張子が無い', `${USER}/${PHOTO_A}`],
    ['前に空白', ` ${USER}/${PHOTO_A}.jpg`],
    ['後ろに空白', `${USER}/${PHOTO_A}.jpg `],
    ['改行が付く', `${USER}/${PHOTO_A}.jpg\n`],
    ['先頭にスラッシュ', `/${USER}/${PHOTO_A}.jpg`],
    ['フォルダが余計に付く', `${USER}/sub/${PHOTO_A}.jpg`],
    ['二重スラッシュ', `${USER}//${PHOTO_A}.jpg`],
    ['パストラバーサル（../ で他ユーザーへ）', `${USER}/../${OTHER_USER}/${PHOTO_A}.jpg`],
    ['パストラバーサル（../ を含む自分のパス）', `${USER}/../${USER}/${PHOTO_A}.jpg`],
    ['URLエンコードされた ../', `${USER}/%2e%2e/${OTHER_USER}/${PHOTO_A}.jpg`],
    ['バックスラッシュ区切り', `${USER}\\${PHOTO_A}.jpg`],
    ['ユーザーIDの大文字小文字が違う', `${USER.toUpperCase()}/${PHOTO_A}.jpg`],
    ['写真IDの大文字小文字が違う', `${USER}/${PHOTO_A.toUpperCase()}.jpg`],
    ['フォルダの前方一致だけ（別ユーザーIDが自分のIDで始まる）', `${USER}x/${PHOTO_A}.jpg`],
    ['別のバケット名の接頭辞', `photo-compressed/${USER}/${PHOTO_A}.jpg`],
    ['全く別の形式', 'avatars/me.png'],
  ])('不正なパス形式（%s）→ 403', (_label, path) => {
    const result = check([photo(PHOTO_A, { storage_path: path })])
    expect(result).toMatchObject({ ok: false, status: 403, error: PHOTO_ACCESS_DENIED_MESSAGE, reason: 'invalid_storage_path' })
  })

  it('文字列でない storage_path（数値・オブジェクト）は拒否する', () => {
    expect(check([photo(PHOTO_A, { storage_path: 123 })])).toMatchObject({ ok: false })
    expect(check([photo(PHOTO_A, { storage_path: { a: 1 } })])).toMatchObject({ ok: false })
  })

  it('1枚でも不正なパスなら、他の写真が正常でも全体を拒否する', () => {
    const result = check(
      [photo(PHOTO_A), photo(PHOTO_B, { storage_path: `${OTHER_USER}/${PHOTO_B}.jpg` })],
      [project()],
      [PHOTO_A, PHOTO_B],
    )
    expect(result).toMatchObject({ ok: false, status: 403 })
  })
})

describe('失敗時の応答に他ユーザーの情報を含めない', () => {
  it('応答のエラー文は固定で、storage_path・写真ID・ユーザーID・URLを含まない', () => {
    const results = [
      check([photo(PHOTO_A, { storage_path: `${OTHER_USER}/${PHOTO_B}.jpg` })]),
      check([photo(PHOTO_A, { user_id: OTHER_USER })]),
      check([photo(PHOTO_A, { project_id: OTHER_PROJECT })]),
      check([photo(PHOTO_A, { storage_path: null })]),
    ]
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(Object.keys(result).sort()).toEqual(['error', 'ok', 'reason', 'status'])
        for (const secret of [OTHER_USER, PHOTO_A, PHOTO_B, OTHER_PROJECT, USER, 'http']) {
          expect(result.error).not.toContain(secret)
        }
      }
    }
  })
})
