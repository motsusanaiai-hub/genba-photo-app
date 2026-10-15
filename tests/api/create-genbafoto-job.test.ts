import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequest, createResponse } from './fakes'

// 写真取得API（create-genbafoto-job）：署名付きURLを発行する前の認可。
// Supabase はすべてモック（外部サービスには接続しない）。異常系では、署名付きURLの発行処理
// （service_role クライアントの生成・createSignedUrls）が一度も呼ばれないことも確認する。

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  createSignedUrls: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('../../api/_lib/supabaseAdmin.ts', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }))

import handler from '../../api/create-genbafoto-job'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PHOTO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const PHOTO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const PHOTO_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PROJECT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}

type Row = Record<string, unknown>
const photoRow = (id: string, overrides: Row = {}): Row => ({
  id,
  user_id: USER,
  project_id: PROJECT,
  storage_path: `${USER}/${id}.jpg`,
  ...overrides,
})
const projectRow = (id = PROJECT, overrides: Row = {}): Row => ({ id, user_id: USER, deleted_at: null, ...overrides })

/**
 * 利用者のJWTを付けたクライアントのフェイク。RLS は「呼び出し側が渡した行がそのまま返る」ものとして扱い、
 * 認可の判断は API の側（validatePhotoAccess）が行うことを確認する。
 */
function setupSupabase(options: {
  user?: { id: string } | null
  userError?: unknown
  photos?: Row[]
  projects?: Row[]
  photosError?: unknown
  projectsError?: unknown
}) {
  const queried: string[] = []
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: USER } : options.user },
        error: options.userError ?? null,
      })),
    },
    from: vi.fn((table: string) => ({
      select: () => ({
        in: async () => {
          queried.push(table)
          if (table === 'photos') return { data: options.photos ?? [], error: options.photosError ?? null }
          if (table === 'projects') return { data: options.projects ?? [], error: options.projectsError ?? null }
          return { data: [], error: null }
        },
      }),
    })),
  }
  mocks.createClient.mockReturnValue(client)
  return { client, queried }
}

function call(photoIds: string[], headers: Record<string, string> = { authorization: 'Bearer token' }) {
  const { res, result } = createResponse()
  const done = handler(createRequest({ headers, body: { photoIds } }), res)
  return { done, result }
}

function expectNoSigning() {
  expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled()
  expect(mocks.createSignedUrls).not.toHaveBeenCalled()
}

/** 応答に、他ユーザーの情報・パス・署名付きURLが含まれていないこと */
function expectNoLeak(body: unknown) {
  const text = JSON.stringify(body)
  for (const secret of [OTHER_USER, PHOTO_OTHER, OTHER_PROJECT, 'storage', 'signed', 'http', 'token=', '.jpg']) {
    expect(text).not.toContain(secret)
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.VITE_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key-dummy'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-dummy'

  vi.clearAllMocks()
  mocks.createSupabaseAdminClient.mockReturnValue({
    storage: { from: vi.fn(() => ({ createSignedUrls: mocks.createSignedUrls })) },
  })
  mocks.createSignedUrls.mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?token=dummy`, error: null })),
    error: null,
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

describe('正常系', () => {
  it('本人の写真・本人の工事案件・正しい storage_path → 署名付きURLを発行（応答形式は従来どおり）', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1)], projects: [projectRow()] })
    const { done, result } = call([PHOTO_1])
    await done

    expect(result.statusCode).toBe(200)
    const body = result.body as { expiresAt: string; photos: { id: string; imageUrl: string }[] }
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'photos'])
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false)
    expect(body.photos).toEqual([{ id: PHOTO_1, imageUrl: `https://signed.example/${USER}/${PHOTO_1}.jpg?token=dummy` }])
    expect(mocks.createSignedUrls).toHaveBeenCalledWith([`${USER}/${PHOTO_1}.jpg`], 1800)
  })

  it('複数写真（複数の工事案件にまたがる場合を含む）をまとめて発行する', async () => {
    setupSupabase({
      photos: [photoRow(PHOTO_1), photoRow(PHOTO_2, { project_id: OTHER_PROJECT })],
      projects: [projectRow(), projectRow(OTHER_PROJECT)],
    })
    const { done, result } = call([PHOTO_1, PHOTO_2])
    await done

    expect(result.statusCode).toBe(200)
    const body = result.body as { photos: { id: string }[] }
    expect(body.photos.map((p) => p.id).sort()).toEqual([PHOTO_1, PHOTO_2])
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1)
  })

  it('JWTで確定した本人のIDで、写真と工事案件をRLS付きクライアントから取得する（service_role は署名にだけ使う）', async () => {
    const { client, queried } = setupSupabase({ photos: [photoRow(PHOTO_1)], projects: [projectRow()] })
    await call([PHOTO_1]).done

    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://staging-ref.supabase.co',
      'anon-key-dummy',
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer token' } } }),
    )
    expect(client.auth.getUser).toHaveBeenCalledWith('token')
    expect(queried).toEqual(['photos', 'projects'])
    // service_role クライアントは、認可が通った後にだけ作られる
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledTimes(1)
  })
})

describe('異常系：認証', () => {
  it('Authorization ヘッダーなし → 401。Supabase にも署名にも触れない', async () => {
    const { done, result } = call([PHOTO_1], {})
    await done
    expect(result.statusCode).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expectNoSigning()
  })

  it('Bearer 形式でないヘッダー → 401', async () => {
    const { done, result } = call([PHOTO_1], { authorization: 'Basic abc' })
    await done
    expect(result.statusCode).toBe(401)
    expectNoSigning()
  })

  it('JWTが不正（getUser がエラー）→ 401。写真の取得も署名もしない', async () => {
    const { client } = setupSupabase({ user: null, userError: { status: 401 } })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(401)
    expect(client.from).not.toHaveBeenCalled()
    expectNoSigning()
  })

  it('JWTは通ってもユーザーが返らない → 401', async () => {
    setupSupabase({ user: null })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(401)
    expectNoSigning()
  })
})

describe('異常系：所有者・工事案件', () => {
  it('他ユーザーの写真（RLSで返らず件数が足りない）→ 403', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1)], projects: [projectRow()] })
    const { done, result } = call([PHOTO_1, PHOTO_OTHER])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
    expectNoLeak(result.body)
  })

  it('他ユーザーの工事案件を指す写真（自分の写真行だが project_id が他人）→ 403', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1, { project_id: OTHER_PROJECT })], projects: [] })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
    expectNoLeak(result.body)
  })

  it('工事案件の所有者が本人でない → 403', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1)], projects: [projectRow(PROJECT, { user_id: OTHER_USER })] })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
    expectNoLeak(result.body)
  })

  it('削除済みの工事案件 → 403', async () => {
    setupSupabase({
      photos: [photoRow(PHOTO_1)],
      projects: [projectRow(PROJECT, { deleted_at: '2026-10-01T00:00:00Z' })],
    })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
  })

  it('写真の所有者が本人でない行が返ってきても → 403', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1, { user_id: OTHER_USER })], projects: [projectRow()] })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
  })
})

describe('異常系：storage_path', () => {
  it.each([
    ['他ユーザーの storage_path', `${OTHER_USER}/${PHOTO_1}.jpg`],
    ['他の写真IDの storage_path', `${USER}/${PHOTO_OTHER}.jpg`],
    ['パストラバーサル', `${USER}/../${OTHER_USER}/${PHOTO_1}.jpg`],
    ['余計なパス', `${USER}/x/${PHOTO_1}.jpg`],
    ['拡張子が違う', `${USER}/${PHOTO_1}.png`],
    ['前後の空白', ` ${USER}/${PHOTO_1}.jpg `],
    ['不正なパス形式', 'not-a-valid-path'],
  ])('%s → 403。署名付きURLは発行しない', async (_label, path) => {
    setupSupabase({ photos: [photoRow(PHOTO_1, { storage_path: path })], projects: [projectRow()] })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
    expectNoLeak(result.body)
  })

  it('storage_path が null → 409（従来どおり）。署名付きURLは発行しない', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1, { storage_path: null })], projects: [projectRow()] })
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(409)
    expect(result.body).toEqual({ error: '同期が完了していない写真が含まれています' })
    expectNoSigning()
  })

  it('複数写真のうち1枚だけ不正 → 全体を拒否し、正常な写真の分も署名しない', async () => {
    setupSupabase({
      photos: [photoRow(PHOTO_1), photoRow(PHOTO_2, { storage_path: `${OTHER_USER}/${PHOTO_2}.jpg` })],
      projects: [projectRow()],
    })
    const { done, result } = call([PHOTO_1, PHOTO_2])
    await done
    expect(result.statusCode).toBe(403)
    expectNoSigning()
  })

  it('拒否時のサーバーログに、パス・写真ID・署名付きURLを出さない（分類のみ）', async () => {
    setupSupabase({ photos: [photoRow(PHOTO_1, { storage_path: `${OTHER_USER}/${PHOTO_1}.jpg` })], projects: [projectRow()] })
    await call([PHOTO_1]).done
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(logged).toContain('invalid_storage_path')
    for (const secret of [OTHER_USER, USER, PHOTO_1, '.jpg', 'http']) expect(logged).not.toContain(secret)
  })
})

describe('既存の動作を維持している', () => {
  it('取得エラー（photos・projects）→ 500（従来と同じ文言）。署名しない', async () => {
    setupSupabase({ photosError: { message: 'boom' } })
    const a = call([PHOTO_1])
    await a.done
    expect(a.result.statusCode).toBe(500)

    setupSupabase({ photos: [photoRow(PHOTO_1)], projectsError: { message: 'boom' } })
    const b = call([PHOTO_1])
    await b.done
    expect(b.result.statusCode).toBe(500)
    expect(b.result.body).toEqual({ error: '写真情報の取得に失敗しました' })
    expectNoSigning()
  })

  it('環境変数が未設定 → 500。Supabase にも触れない', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { done, result } = call([PHOTO_1])
    await done
    expect(result.statusCode).toBe(500)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('不正なリクエスト本文（UUIDでない・空・301件）→ 400。認証より前に止まる', async () => {
    for (const ids of [['not-a-uuid'], [], Array.from({ length: 301 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)]) {
      const { done, result } = call(ids)
      await done
      expect(result.statusCode).toBe(400)
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('POST 以外 → 405', async () => {
    const { res, result } = createResponse()
    await handler(createRequest({ method: 'GET' }), res)
    expect(result.statusCode).toBe(405)
  })
})
