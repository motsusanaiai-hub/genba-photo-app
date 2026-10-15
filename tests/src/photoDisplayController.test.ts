import { describe, expect, it, vi } from 'vitest'
import { PhotoDisplayController, type PhotoDisplayDeps, type PhotoDisplayState } from '@/lib/photoDisplayController'
import type { Photo } from '@/types/photo'

// M-1: 写真の取得・再取得中に別の写真へ切り替えても、古い写真を表示しないこと。
// 非同期処理の完了順を Promise で制御して確認する（外部サービスには接続しない）。
// 写真の切り替え＝古い controller の dispose と、新しい写真の controller の作成（usePhotoDisplay と同じ）。

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const photo = (id: string, extra: Partial<Photo> = {}) => ({ id, thumbnail_data_url: '', storage_path: `u/${id}.jpg`, user_id: 'u', ...extra }) as Photo

interface Harness {
  deps: PhotoDisplayDeps
  local: Map<string, ReturnType<typeof deferred<string | null>>>
  display: Map<string, ReturnType<typeof deferred<string | null>>>
  refresh: Map<string, ReturnType<typeof deferred<string | null>>>
  revoked: string[]
}
function harness(canAccess = true): Harness {
  const h: Harness = { local: new Map(), display: new Map(), refresh: new Map(), revoked: [], deps: undefined as never }
  const get = (m: Map<string, ReturnType<typeof deferred<string | null>>>, id: string) => {
    if (!m.has(id)) m.set(id, deferred<string | null>())
    return m.get(id)!
  }
  h.deps = {
    getLocalObjectUrl: (id) => get(h.local, id).promise,
    loadDisplayUrl: (p) => get(h.display, p.id).promise,
    refreshDisplayUrl: (p) => get(h.refresh, p.id).promise,
    revokeObjectUrl: (url) => h.revoked.push(url),
    canAccess: () => canAccess,
  }
  return h
}

/** 画面（状態）。controller の通知を記録し、最後の状態を保持する */
function screen() {
  const states: PhotoDisplayState[] = []
  return { states, onChange: (s: PhotoDisplayState) => states.push(s), get last() { return states[states.length - 1] } }
}

describe('通常表示', () => {
  it('写真Aを開くと、取得中は何も出さず、取得後に画像Aを表示する', async () => {
    const h = harness()
    const s = screen()
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loading = c.load()
    expect(s.last).toEqual({ url: null, loading: true, localOriginal: false })
    h.local.get('A')!.resolve(null)
    await flush()
    h.display.get('A')!.resolve('cloud-A')
    await loading
    expect(s.last).toEqual({ url: 'cloud-A', loading: false, localOriginal: false })
  })

  it('端末内の原本（IndexedDB）があれば最優先で使い、クラウドには取りに行かない', async () => {
    const h = harness()
    const s = screen()
    const loadDisplay = vi.spyOn(h.deps, 'loadDisplayUrl')
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loading = c.load()
    h.local.get('A')!.resolve('blob:original-A')
    await loading
    expect(s.last).toEqual({ url: 'blob:original-A', loading: false, localOriginal: true })
    expect(loadDisplay).not.toHaveBeenCalled()
  })

  it('クラウド画像も端末内の画像も無い場合は、url=null で取得中を終える（従来の代替表示）', async () => {
    const h = harness()
    const s = screen()
    const c = new PhotoDisplayController(photo('A', { storage_path: null }), h.deps, s.onChange)
    const loading = c.load()
    h.local.get('A')!.resolve(null)
    await flush()
    h.display.get('A')!.resolve(null)
    await loading
    expect(s.last).toEqual({ url: null, loading: false, localOriginal: false })
  })

  it('本人の写真でなければ、端末内にもクラウドにも取りに行かず、表示しない', async () => {
    const h = harness(false)
    const s = screen()
    const getLocal = vi.spyOn(h.deps, 'getLocalObjectUrl')
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    await c.load()
    expect(getLocal).not.toHaveBeenCalled()
    expect(s.last).toEqual({ url: null, loading: false, localOriginal: false })
  })
})

describe('写真の切り替え', () => {
  it('A取得中にBへ切り替え、Aが後から完了しても、Aを表示しない', async () => {
    const h = harness()
    const s = screen()
    const a = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void a.load()
    a.dispose() // Bへ切り替え
    const b = new PhotoDisplayController(photo('B'), h.deps, s.onChange)
    const loadingB = b.load()
    h.local.get('B')!.resolve(null)
    await flush()
    h.display.get('B')!.resolve('cloud-B')
    await loadingB
    h.local.get('A')!.resolve(null)
    await flush()
    h.display.get('A')?.resolve('cloud-A')
    await flush()
    expect(s.last.url).toBe('cloud-B')
    expect(s.states.some((x) => x.url === 'cloud-A')).toBe(false)
  })

  it('A取得中にBへ切り替え、Bが先に完了しても、後から完了するAの結果で上書きされない', async () => {
    const h = harness()
    const s = screen()
    const a = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void a.load()
    h.local.get('A')!.resolve(null) // Aは、クラウド画像の取得待ち
    await flush()
    a.dispose()
    const b = new PhotoDisplayController(photo('B'), h.deps, s.onChange)
    const loadingB = b.load()
    h.local.get('B')!.resolve('blob:B')
    await loadingB
    h.display.get('A')!.resolve('cloud-A') // Aが最後に完了
    await flush()
    expect(s.last).toEqual({ url: 'blob:B', loading: false, localOriginal: true })
  })

  it('切り替え直後に、前の写真のURLが残らない（Bの取得中は url=null）', async () => {
    const h = harness()
    const s = screen()
    const a = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loadingA = a.load()
    h.local.get('A')!.resolve('blob:A')
    await loadingA
    expect(s.last.url).toBe('blob:A')
    a.dispose()
    const b = new PhotoDisplayController(photo('B'), h.deps, s.onChange)
    void b.load()
    expect(s.last).toEqual({ url: null, loading: true, localOriginal: false })
  })

  it('A→B→A と素早く切り替えても、最初のAの結果は使わない（最後のAの結果だけ）', async () => {
    const h = harness()
    const s = screen()
    const a1 = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void a1.load()
    a1.dispose()
    const b = new PhotoDisplayController(photo('B'), h.deps, s.onChange)
    void b.load()
    b.dispose()
    // 同じ写真Aを再び開くため、取得待ちを作り直す（1回目のAの待ちとは別）
    const first = h.local.get('A')!
    h.local.delete('A')
    h.display.delete('A')
    const a2 = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loadingA2 = a2.load()
    first.resolve('blob:stale-A') // 1回目のAの結果が、2回目より先に完了
    await flush()
    expect(s.states.some((x) => x.url === 'blob:stale-A')).toBe(false)
    expect(h.revoked).toContain('blob:stale-A') // 使わなかった原本のURLは解放する
    h.local.get('A')!.resolve('blob:fresh-A')
    await loadingA2
    expect(s.last.url).toBe('blob:fresh-A')
  })
})

describe('取得失敗後の再取得（署名付きURLの作り直し）', () => {
  async function failedCloud(h: Harness, s: ReturnType<typeof screen>, id: string) {
    const c = new PhotoDisplayController(photo(id), h.deps, s.onChange)
    const loading = c.load()
    h.local.get(id)!.resolve(null)
    await flush()
    h.display.get(id)!.resolve(`cloud-${id}`)
    await loading
    return c
  }

  it('Aの読み込み失敗→再取得中にBへ切り替えても、Aの再取得結果は表示しない', async () => {
    const h = harness()
    const s = screen()
    const a = await failedCloud(h, s, 'A')
    void a.handleError() // 再取得を開始（まだ完了しない）
    a.dispose() // Bへ切り替え
    const b = new PhotoDisplayController(photo('B'), h.deps, s.onChange)
    const loadingB = b.load()
    h.local.get('B')!.resolve('blob:B')
    await loadingB
    h.refresh.get('A')!.resolve('cloud-A-refreshed')
    await flush()
    expect(s.states.some((x) => x.url === 'cloud-A-refreshed')).toBe(false)
    expect(s.last.url).toBe('blob:B')
  })

  it('Aの再取得が完了し、まだAを表示している間は、新しいURLで表示できる', async () => {
    const h = harness()
    const s = screen()
    const a = await failedCloud(h, s, 'A')
    const handling = a.handleError()
    h.refresh.get('A')!.resolve('cloud-A-refreshed')
    await handling
    expect(s.last).toEqual({ url: 'cloud-A-refreshed', loading: false, localOriginal: false })
  })

  it('再取得は1回だけ。それでも失敗なら表示しない（無限に再取得しない）', async () => {
    const h = harness()
    const s = screen()
    const refresh = vi.spyOn(h.deps, 'refreshDisplayUrl')
    const a = await failedCloud(h, s, 'A')
    const first = a.handleError()
    h.refresh.get('A')!.resolve('cloud-A-2')
    await first
    await a.handleError()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(s.last.url).toBeNull()
  })

  it('端末内の原本の読み込み失敗は、署名付きURLの再取得をしない', async () => {
    const h = harness()
    const s = screen()
    const refresh = vi.spyOn(h.deps, 'refreshDisplayUrl')
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loading = c.load()
    h.local.get('A')!.resolve('blob:A')
    await loading
    await c.handleError()
    expect(refresh).not.toHaveBeenCalled()
    expect(s.last.url).toBeNull()
  })
})

describe('画面を閉じた後・参照写真の選択解除後', () => {
  it('ライトボックス／オーバーレイを閉じた後に完了した取得は、状態を更新しない（原本のURLは解放する）', async () => {
    const h = harness()
    const s = screen()
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void c.load()
    const count = s.states.length
    c.dispose()
    h.local.get('A')!.resolve('blob:A')
    await flush()
    expect(s.states.length).toBe(count)
    expect(h.revoked).toContain('blob:A')
  })

  it('閉じた後にクラウド画像・再取得が完了しても、状態を更新しない', async () => {
    const h = harness()
    const s = screen()
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void c.load()
    h.local.get('A')!.resolve(null)
    await flush()
    c.dispose()
    const count = s.states.length
    h.display.get('A')!.resolve('cloud-A')
    await flush()
    expect(s.states.length).toBe(count)

    const h2 = harness()
    const s2 = screen()
    const c2 = new PhotoDisplayController(photo('A'), h2.deps, s2.onChange)
    const loading = c2.load()
    h2.local.get('A')!.resolve(null)
    await flush()
    h2.display.get('A')!.resolve('cloud-A')
    await loading
    void c2.handleError()
    c2.dispose()
    const count2 = s2.states.length
    h2.refresh.get('A')!.resolve('cloud-A-2')
    await flush()
    expect(s2.states.length).toBe(count2)
  })

  it('参照写真の選択解除（画面を閉じる）後に、古い参照写真の画像が復活しない', async () => {
    const h = harness()
    const s = screen()
    const c = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loading = c.load()
    h.local.get('A')!.resolve('blob:A')
    await loading
    c.dispose() // 解除。原本のURLは解放される
    expect(h.revoked).toEqual(['blob:A'])
    await c.handleError() // 解除後の読み込みエラーでも何も起きない
    expect(s.last.url).toBe('blob:A') // 以降の通知は無い
    expect(s.states).toHaveLength(2)
  })
})

describe('React StrictMode（マウント→アンマウント→再マウント）', () => {
  it('開発時の二重マウントでも、最初のマウントの結果は破棄され、2回目で正しく表示される', async () => {
    const h = harness()
    const s = screen()
    const first = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    void first.load()
    first.dispose() // StrictMode の擬似アンマウント
    const firstLocal = h.local.get('A')!
    h.local.delete('A')
    const second = new PhotoDisplayController(photo('A'), h.deps, s.onChange)
    const loading = second.load()
    firstLocal.resolve('blob:first')
    await flush()
    expect(s.states.some((x) => x.url === 'blob:first')).toBe(false)
    h.local.get('A')!.resolve('blob:second')
    await loading
    expect(s.last).toEqual({ url: 'blob:second', loading: false, localOriginal: true })
    expect(h.revoked).toEqual(['blob:first'])
  })
})
