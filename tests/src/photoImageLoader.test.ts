import { describe, expect, it, vi } from 'vitest'
import { CloudPhotoAccess, REFRESH_MARGIN_SEC, SIGNED_URL_TTL_SEC, type CloudStorageApi } from '@/lib/cloudPhotoAccess'
import { PhotoImageLoader, type PhotoImageSource } from '@/lib/photoImageLoader'

// 写真1枚の表示URLを決める状態機械（端末内の画像を優先 → クラウドは本人の認証で署名付きURL）。
// Supabase はフェイク、タイマーと時計は手動（外部サービスには接続しない）。

const HOUR = 3600 * 1000
const PATH = 'user-a/photo-1.jpg'

function setup(options: { failPaths?: Set<string>; user?: string | null } = {}) {
  let clock = 1_000_000
  let userId: string | null = options.user === undefined ? 'user-a' : options.user
  let counter = 0
  const signCalls: string[][] = []

  const storage: CloudStorageApi = {
    async createSignedUrls(paths) {
      signCalls.push([...paths])
      return {
        data: paths.map((p) =>
          options.failPaths?.has(p)
            ? { path: p, signedUrl: null, error: 'Object not found' }
            : { path: p, signedUrl: `https://signed.example/${p}?token=${++counter}`, error: null },
        ),
        error: null,
      }
    },
    download: async () => ({ data: null, error: null }),
  }
  const access = new CloudPhotoAccess({
    storage,
    getUserId: () => userId,
    now: () => clock,
    defer: (task) => queueMicrotask(task),
  })

  // 手動のタイマー
  const timers: Array<{ id: number; at: number; fn: () => void; cleared: boolean }> = []
  let timerId = 0
  const deps = {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { id: ++timerId, at: clock + ms, fn, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle: unknown) => {
      ;(handle as { cleared: boolean }).cleared = true
    },
  }
  const pendingTimers = () => timers.filter((t) => !t.cleared)
  const advance = async (ms: number) => {
    clock += ms
    for (const timer of timers.filter((t) => !t.cleared && t.at <= clock)) {
      timer.cleared = true
      timer.fn()
    }
    await flush()
  }

  const make = (source: Partial<PhotoImageSource> = {}) =>
    new PhotoImageLoader(access, { local: null, path: PATH, userId, ...source }, deps)
  return { access, make, signCalls, pendingTimers, advance, setUser: (id: string | null) => (userId = id) }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('端末内の画像を優先する', () => {
  it('端末内の画像（base64）があれば、すぐに ready。クラウドには通信しない', async () => {
    const { make, signCalls } = setup()
    const loader = make({ local: 'data:image/jpeg;base64,AAA' })
    expect(loader.getSnapshot()).toEqual({ src: 'data:image/jpeg;base64,AAA', status: 'ready' })
    loader.start()
    await flush()
    expect(signCalls).toHaveLength(0)
    expect(loader.getSnapshot().src).toBe('data:image/jpeg;base64,AAA')
  })

  it('端末内の画像があるときは、storage_path があってもクラウドを使わない', async () => {
    const { make, signCalls } = setup()
    make({ local: 'data:image/png;base64,BBB', path: PATH }).start()
    await flush()
    expect(signCalls).toHaveLength(0)
  })

  it('端末内の画像の読み込み失敗は、作り直せない（failed になる）', () => {
    const { make } = setup()
    const loader = make({ local: 'data:image/jpeg;base64,BROKEN' })
    loader.handleError()
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
  })
})

describe('クラウドにだけある画像', () => {
  it('最初は loading。start すると署名付きURLを取得して ready になる（変化は購読者に通知される）', async () => {
    const { make, signCalls } = setup()
    const loader = make()
    const listener = vi.fn()
    loader.subscribe(listener)
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'loading' })

    loader.start()
    await flush()
    expect(signCalls).toEqual([[PATH]])
    expect(loader.getSnapshot().status).toBe('ready')
    expect(loader.getSnapshot().src).toMatch(/^https:\/\/signed\.example\//)
    expect(listener).toHaveBeenCalled()
  })

  it('取得済みの有効なURLがあれば、最初から ready（loading を経由せず、通信もしない）', async () => {
    const { make, access, signCalls } = setup()
    const url = await access.getSignedUrl(PATH)
    const loader = make()
    expect(loader.getSnapshot()).toEqual({ src: url, status: 'ready' })
    loader.start()
    await flush()
    expect(signCalls).toHaveLength(1)
  })

  it('storage_path が null で端末内の画像も無い → 通信せず failed', async () => {
    const { make, signCalls } = setup()
    const loader = make({ path: null })
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
    loader.start()
    await flush()
    expect(signCalls).toHaveLength(0)
  })

  it('未ログイン → 通信せず failed', async () => {
    const { make, signCalls } = setup({ user: null })
    const loader = make({ userId: null })
    expect(loader.getSnapshot().status).toBe('failed')
    loader.start()
    await flush()
    expect(signCalls).toHaveLength(0)
  })

  it('クラウドからの取得に失敗 → failed（例外を出さず、画面全体は止めない）', async () => {
    const { make } = setup({ failPaths: new Set([PATH]) })
    const loader = make()
    loader.start()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
  })

  it('取得中に画面から消えた（dispose）場合、その結果は反映しない', async () => {
    const { make } = setup()
    const loader = make()
    loader.start()
    loader.dispose()
    await flush()
    expect(loader.getSnapshot().status).toBe('loading')
  })

  it('StrictMode のように start → dispose → start を繰り返しても、取得は1回にまとまり、正しく ready になる', async () => {
    const { make, signCalls } = setup()
    const loader = make()
    loader.start()
    loader.dispose()
    loader.start()
    await flush()
    expect(loader.getSnapshot().status).toBe('ready')
    expect(signCalls).toHaveLength(1)
  })
})

describe('署名付きURLの更新・失効', () => {
  it('失効の少し前に、自動でURLを作り直す（タイマーは1つだけ）', async () => {
    const { make, signCalls, pendingTimers, advance } = setup()
    const loader = make()
    loader.start()
    await flush()
    const first = loader.getSnapshot().src
    expect(pendingTimers()).toHaveLength(1)

    await advance(HOUR - REFRESH_MARGIN_SEC * 1000 + 1000)
    const second = loader.getSnapshot().src
    expect(second).not.toBe(first)
    expect(signCalls).toHaveLength(2)
    expect(loader.getSnapshot().status).toBe('ready')
    expect(pendingTimers()).toHaveLength(1) // 次の更新の予約
    expect(SIGNED_URL_TTL_SEC).toBe(3600)
  })

  it('画面から消えたら、更新のタイマーを止める（以降は通信しない）', async () => {
    const { make, signCalls, pendingTimers, advance } = setup()
    const loader = make()
    loader.start()
    await flush()
    loader.dispose()
    expect(pendingTimers()).toHaveLength(0)
    await advance(HOUR * 2)
    expect(signCalls).toHaveLength(1)
  })

  it('画像の読み込みに失敗（署名付きURLの失効など）→ URLを1度だけ作り直し、新しいURLになる', async () => {
    const { make, signCalls } = setup()
    const loader = make()
    loader.start()
    await flush()
    const stale = loader.getSnapshot().src

    loader.handleError()
    await flush()
    expect(signCalls).toHaveLength(2)
    expect(loader.getSnapshot().status).toBe('ready')
    expect(loader.getSnapshot().src).not.toBe(stale)
  })

  it('作り直したURLでも読み込みに失敗したら failed（無限に再取得しない）', async () => {
    const { make, signCalls } = setup()
    const loader = make()
    loader.start()
    await flush()
    loader.handleError()
    await flush()
    loader.handleError()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
    expect(signCalls).toHaveLength(2)
  })

  it('作り直しの結果が取得できなければ failed', async () => {
    const failing = new Set<string>()
    const { make } = setup({ failPaths: failing })
    const loader = make()
    loader.start()
    await flush()
    failing.add(PATH)
    loader.handleError()
    await flush()
    expect(loader.getSnapshot().status).toBe('failed')
  })

  it('定期の更新のあとは、また1度だけ作り直せる', async () => {
    const { make, signCalls, advance } = setup()
    const loader = make()
    loader.start()
    await flush()
    loader.handleError() // 1回目の作り直し
    await flush()
    await advance(HOUR - REFRESH_MARGIN_SEC * 1000 + 1000) // 定期の更新
    loader.handleError() // 更新後にもう一度失敗 → 作り直せる
    await flush()
    expect(loader.getSnapshot().status).toBe('ready')
    expect(signCalls.length).toBeGreaterThanOrEqual(4)
  })
})

describe('ユーザー切り替え・ログアウト・削除', () => {
  it('前のユーザーのURLをキャッシュから表示しない（別ユーザーの Loader は loading から始まる）', async () => {
    const { make, access, setUser } = setup()
    await access.getSignedUrl(PATH)
    setUser('user-b')
    const loader = make({ userId: 'user-b' })
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'loading' })
  })

  it('ログアウト（clear）後に始まった取得では、前のユーザーのURLを使わない', async () => {
    const { make, access, signCalls } = setup()
    await access.getSignedUrl(PATH)
    access.clear()
    const loader = make()
    expect(loader.getSnapshot().status).toBe('loading')
    loader.start()
    await flush()
    expect(signCalls).toHaveLength(2)
  })

  it('写真を削除（evict）した後は、取得済みのURLを使い続けない', async () => {
    const { make, access } = setup()
    await access.getSignedUrl(PATH)
    access.evict([PATH])
    expect(make().getSnapshot().status).toBe('loading')
  })
})
