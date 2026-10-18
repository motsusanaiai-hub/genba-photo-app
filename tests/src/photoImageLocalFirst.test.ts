import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// M-2／M-4: 端末内の600px圧縮画像（IndexedDB）を、クラウドの署名付きURLより先に使う。
//   一覧など：thumbnail_data_url → IndexedDB の圧縮画像 → クラウドの署名付きURL → 代替表示
//   ライトボックス・オーバーレイ：原本 → thumbnail → 圧縮画像 → クラウド → 代替表示
// IndexedDB・クラウドの取得はモック。呼び出し回数と、非同期処理の完了順を制御して確認する。外部には接続しない。

const mocks = vi.hoisted(() => ({
  idbKeys: [] as string[],
  idb: new Map<string, Blob>(),
}))
vi.mock('idb-keyval', () => ({
  get: async (key: string) => {
    mocks.idbKeys.push(key)
    return mocks.idb.get(key)
  },
  set: async () => {},
  del: async () => {},
}))
vi.mock('@/store/authStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<{ user: { id: string } | null; initialized: boolean }>(() => ({ user: null, initialized: true }))
  return { useAuthStore: Object.assign(<T>(sel: (s: ReturnType<typeof store.getState>) => T) => sel(store.getState()), store) }
})
vi.mock('@/store/projectStore', () => ({
  useProjectStore: <T>(sel: (s: { projects: unknown[] }) => T) =>
    sel({ projects: [{ id: 'proj-a', user_id: 'user-a' }, { id: 'proj-b', user_id: 'user-b' }] }),
}))

import { PhotoImageLoader } from '@/lib/photoImageLoader'
import { PhotoDisplayController, type PhotoDisplayDeps, type PhotoDisplayState } from '@/lib/photoDisplayController'
import { photoStorage } from '@/lib/photoStorage'
import { PhotoImage } from '@/components/photo/PhotoImage'
import { useAuthStore } from '@/store/authStore'
import type { Photo } from '@/types/photo'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

// ---- PhotoImageLoader（一覧・カード・台帳・比較・参照写真選択） ----
function makeLoader(
  source: { local?: string | null; path?: string | null; userId?: string | null; canReadLocal?: boolean },
  read: () => Promise<string | null>,
) {
  const signed = vi.fn(async (path: string) => `https://signed.example/${path}`)
  const access = {
    peek: () => null,
    getSignedUrl: signed,
    refreshAt: () => null,
  }
  const revoked: string[] = []
  const readFn = vi.fn(read)
  const loader = new PhotoImageLoader(
    access as never,
    { local: source.local ?? null, path: source.path ?? null, userId: source.userId ?? 'user-a', canReadLocal: source.canReadLocal ?? true },
    { readCompressedUrl: readFn, revokeUrl: (u) => revoked.push(u) },
  )
  return { loader, signed, revoked, readFn }
}

describe('一覧の画像（PhotoImageLoader）: 端末内の圧縮画像を先に使う', () => {
  it('thumbnail_data_url があればそれを使う（IndexedDBもクラウドも読まない）', async () => {
    const { loader, signed, readFn } = makeLoader({ local: 'data:thumb', path: 'u/p.jpg' }, async () => 'blob:c')
    loader.start()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: 'data:thumb', status: 'ready' })
    expect(readFn).not.toHaveBeenCalled()
    expect(signed).not.toHaveBeenCalled()
  })

  it('IndexedDB に圧縮画像があれば表示し、署名付きURLを取得しない', async () => {
    const { loader, signed } = makeLoader({ path: 'u/p.jpg' }, async () => 'blob:c')
    expect(loader.getSnapshot().status).toBe('loading')
    loader.start()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: 'blob:c', status: 'ready' })
    expect(signed).not.toHaveBeenCalled()
  })

  it('IndexedDB に無ければ、クラウドの署名付きURLへフォールバックする', async () => {
    const { loader, signed } = makeLoader({ path: 'u/p.jpg' }, async () => null)
    loader.start()
    await flush()
    expect(signed).toHaveBeenCalledTimes(1)
    expect(loader.getSnapshot()).toEqual({ src: 'https://signed.example/u/p.jpg', status: 'ready' })
  })

  it('storage_path が null でも、IndexedDB に圧縮画像があれば表示する（クラウドへは通信しない）', async () => {
    const { loader, signed } = makeLoader({ path: null }, async () => 'blob:c')
    loader.start()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: 'blob:c', status: 'ready' })
    expect(signed).not.toHaveBeenCalled()
  })

  it('storage_path が null で IndexedDB にも無ければ、従来どおりの代替表示（failed）', async () => {
    const { loader, signed } = makeLoader({ path: null }, async () => null)
    loader.start()
    await flush()
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
    expect(signed).not.toHaveBeenCalled()
  })

  it('IndexedDB の読み込みが例外でも、クラウドへフォールバックする（無ければ failed）', async () => {
    const a = makeLoader({ path: 'u/p.jpg' }, async () => {
      throw new Error('idb broken')
    })
    a.loader.start()
    await flush()
    expect(a.signed).toHaveBeenCalledTimes(1)
    expect(a.loader.getSnapshot().status).toBe('ready')
    const b = makeLoader({ path: null }, async () => {
      throw new Error('idb broken')
    })
    b.loader.start()
    await flush()
    expect(b.loader.getSnapshot().status).toBe('failed')
  })

  it('オフライン相当（クラウドは必ず失敗）でも、IndexedDB の圧縮画像は表示できる', async () => {
    const { loader, signed } = makeLoader({ path: 'u/p.jpg' }, async () => 'blob:c')
    signed.mockRejectedValue(new Error('offline'))
    loader.start()
    await flush()
    expect(loader.getSnapshot().src).toBe('blob:c')
    expect(signed).not.toHaveBeenCalled()
  })

  it('所有者確認を通っていない写真（canReadLocal=false）は、IndexedDB もクラウドも読まない', async () => {
    const { loader, signed, readFn } = makeLoader({ path: null, userId: null, canReadLocal: false }, async () => 'blob:c')
    expect(loader.getSnapshot().status).toBe('failed')
    loader.start()
    await flush()
    expect(readFn).not.toHaveBeenCalled()
    expect(signed).not.toHaveBeenCalled()
    expect(loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
  })
})

describe('一覧の画像: 切り替え・アンマウント・Blob URL の解放', () => {
  it('A→B：Aの読み込み中に画面から消えて（dispose）後から完了しても、Aの結果は表示せず、URLを解放する', async () => {
    const d = deferred<string | null>()
    const a = makeLoader({ path: 'u/a.jpg' }, () => d.promise)
    a.loader.start()
    a.loader.dispose()
    const b = makeLoader({ path: 'u/b.jpg' }, async () => 'blob:b')
    b.loader.start()
    await flush()
    d.resolve('blob:a')
    await flush()
    expect(a.loader.getSnapshot().src).toBeNull()
    expect(a.revoked).toEqual(['blob:a'])
    expect(b.loader.getSnapshot().src).toBe('blob:b')
  })

  it('A→B→A：最初のAの読み込みの結果は使わず、最後のAの結果だけを使う', async () => {
    const first = deferred<string | null>()
    const a1 = makeLoader({ path: 'u/a.jpg' }, () => first.promise)
    a1.loader.start()
    a1.loader.dispose()
    const a2 = makeLoader({ path: 'u/a.jpg' }, async () => 'blob:a-fresh')
    a2.loader.start()
    await flush()
    first.resolve('blob:a-stale')
    await flush()
    expect(a1.loader.getSnapshot().src).toBeNull()
    expect(a1.revoked).toEqual(['blob:a-stale'])
    expect(a2.loader.getSnapshot().src).toBe('blob:a-fresh')
  })

  it('アンマウント後は状態を更新せず、表示中だったBlob URLを解放する', async () => {
    const { loader, revoked } = makeLoader({ path: null }, async () => 'blob:c')
    const listener = vi.fn()
    loader.subscribe(listener)
    loader.start()
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
    loader.dispose()
    expect(revoked).toEqual(['blob:c'])
    expect(loader.getSnapshot().src).not.toBe('blob:c') // 解放済みのURLを表示に残さない
  })

  it('StrictMode（start→dispose→start）でも、解放済みのURLを使わず、読み込み直して表示できる', async () => {
    let n = 0
    const { loader, revoked, readFn } = makeLoader({ path: null }, async () => `blob:c${++n}`)
    loader.start()
    await flush()
    loader.dispose()
    loader.start()
    await flush()
    expect(readFn).toHaveBeenCalledTimes(2)
    expect(revoked).toEqual(['blob:c1'])
    expect(loader.getSnapshot()).toEqual({ src: 'blob:c2', status: 'ready' })
  })

  it('端末内の画像の読み込みに失敗したら、URLを解放してクラウドへ切り替える（無ければ failed）', async () => {
    const withCloud = makeLoader({ path: 'u/p.jpg' }, async () => 'blob:c')
    withCloud.loader.start()
    await flush()
    withCloud.loader.handleError()
    await flush()
    expect(withCloud.revoked).toEqual(['blob:c'])
    expect(withCloud.loader.getSnapshot().src).toBe('https://signed.example/u/p.jpg')
    const noCloud = makeLoader({ path: null }, async () => 'blob:c')
    noCloud.loader.start()
    await flush()
    noCloud.loader.handleError()
    expect(noCloud.loader.getSnapshot()).toEqual({ src: null, status: 'failed' })
  })
})

describe('IndexedDB の圧縮画像のキー（既存のまま）', () => {
  beforeEach(() => {
    mocks.idbKeys.length = 0
    mocks.idb.clear()
  })
  it('photo:{id}:c:600 を読む。無ければ null、あれば Blob', async () => {
    expect(await photoStorage.getCompressedBlob('abc')).toBeNull()
    expect(mocks.idbKeys).toEqual(['photo:abc:c:600'])
    const blob = new Blob(['x'])
    mocks.idb.set('photo:abc:c:600', blob)
    expect(await photoStorage.getCompressedBlob('abc')).toBe(blob)
  })
})

describe('所有者確認（H-1）: 画面の描画', () => {
  const login = (id: string | null) =>
    (useAuthStore as unknown as { setState: (s: unknown) => void }).setState({ user: id ? { id } : null, initialized: true })
  const render = (photo: Partial<Photo>) =>
    renderToStaticMarkup(
      createElement(PhotoImage, {
        photo: { id: 'p1', user_id: 'user-a', project_id: 'proj-a', thumbnail_data_url: '', storage_path: null, ...photo } as Photo,
        alt: 'x',
      }),
    )

  it('本人の写真は、端末内の圧縮画像を確認する間は読み込み中', () => {
    login('user-a')
    expect(render({})).toContain('data-photo-image-status="loading"')
  })

  it('他ユーザーの写真・他ユーザーの工事案件の写真・未ログインは、読み込まず代替表示（サムネイルがあっても出さない）', () => {
    login('user-b')
    expect(render({})).toContain('data-photo-image-status="failed"')
    login('user-a')
    expect(render({ project_id: 'proj-b' })).toContain('data-photo-image-status="failed"')
    expect(render({ thumbnail_data_url: 'data:image/jpeg;base64,SECRET', user_id: 'user-b' })).not.toContain('SECRET')
    login(null)
    expect(render({ thumbnail_data_url: 'data:image/jpeg;base64,SECRET' })).not.toContain('SECRET')
  })
})

// ---- PhotoDisplayController（ライトボックス・撮影オーバーレイ） ----
function displayHarness(opts: { original?: string | null; compressed?: () => Promise<string | null>; canAccess?: boolean } = {}) {
  const calls: string[] = []
  const revoked: string[] = []
  const deps: PhotoDisplayDeps = {
    getLocalObjectUrl: async () => (calls.push('original'), opts.original ?? null),
    getLocalCompressedUrl: () => (calls.push('compressed'), (opts.compressed ?? (async () => null))()),
    loadDisplayUrl: async (p) => (calls.push('display'), p.thumbnail_data_url || 'https://signed.example/x'),
    refreshDisplayUrl: async () => null,
    revokeObjectUrl: (u) => revoked.push(u),
    canAccess: () => opts.canAccess ?? true,
  }
  const states: PhotoDisplayState[] = []
  return { deps, calls, revoked, states, onChange: (s: PhotoDisplayState) => states.push(s) }
}
const photo = (extra: Partial<Photo> = {}) => ({ id: 'a', thumbnail_data_url: '', storage_path: 'u/a.jpg', user_id: 'user-a', ...extra }) as Photo

describe('ライトボックス・オーバーレイ（PhotoDisplayController）: 原本 → thumbnail → 圧縮画像 → クラウド', () => {
  it('原本があれば原本を使い、圧縮画像にもクラウドにも行かない', async () => {
    const h = displayHarness({ original: 'blob:orig' })
    await new PhotoDisplayController(photo(), h.deps, h.onChange).load()
    expect(h.states.at(-1)?.url).toBe('blob:orig')
    expect(h.calls).toEqual(['original'])
  })

  it('原本が無くサムネイルがあれば、サムネイルを使う（圧縮画像は読まない）', async () => {
    const h = displayHarness()
    await new PhotoDisplayController(photo({ thumbnail_data_url: 'data:thumb' }), h.deps, h.onChange).load()
    expect(h.states.at(-1)?.url).toBe('data:thumb')
    expect(h.calls).toEqual(['original'])
  })

  it('原本もサムネイルも無ければ、端末内の圧縮画像を使い、クラウドへは行かない', async () => {
    const h = displayHarness({ compressed: async () => 'blob:c' })
    await new PhotoDisplayController(photo(), h.deps, h.onChange).load()
    expect(h.states.at(-1)).toMatchObject({ url: 'blob:c', loading: false })
    expect(h.calls).toEqual(['original', 'compressed'])
  })

  it('storage_path が null でも、圧縮画像があれば表示する', async () => {
    const h = displayHarness({ compressed: async () => 'blob:c' })
    await new PhotoDisplayController(photo({ storage_path: null }), h.deps, h.onChange).load()
    expect(h.states.at(-1)?.url).toBe('blob:c')
  })

  it('圧縮画像が無い・読み込みが例外のときは、クラウドへフォールバックする', async () => {
    const none = displayHarness()
    await new PhotoDisplayController(photo(), none.deps, none.onChange).load()
    expect(none.calls).toEqual(['original', 'compressed', 'display'])
    expect(none.states.at(-1)?.url).toBe('https://signed.example/x')
    const broken = displayHarness({
      compressed: async () => {
        throw new Error('idb broken')
      },
    })
    await new PhotoDisplayController(photo(), broken.deps, broken.onChange).load()
    expect(broken.states.at(-1)?.url).toBe('https://signed.example/x')
  })

  it('他ユーザーの写真は、IndexedDB（原本・圧縮画像）もクラウドも読まない', async () => {
    const h = displayHarness({ original: 'blob:orig', compressed: async () => 'blob:c', canAccess: false })
    await new PhotoDisplayController(photo(), h.deps, h.onChange).load()
    expect(h.calls).toEqual([])
    expect(h.states.at(-1)).toMatchObject({ url: null, loading: false })
  })

  it('圧縮画像の読み込み中に写真が切り替わる／閉じられても、古い結果は表示せず、URLを解放する', async () => {
    const d = deferred<string | null>()
    const h = displayHarness({ compressed: () => d.promise })
    const a = new PhotoDisplayController(photo(), h.deps, h.onChange)
    void a.load()
    await flush()
    const count = h.states.length
    a.dispose()
    d.resolve('blob:stale')
    await flush()
    expect(h.states.length).toBe(count)
    expect(h.revoked).toEqual(['blob:stale'])
  })

  it('表示中の圧縮画像のURLは、画面を閉じたとき（dispose）に解放する', async () => {
    const h = displayHarness({ compressed: async () => 'blob:c' })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    c.dispose()
    expect(h.revoked).toEqual(['blob:c'])
  })
})
