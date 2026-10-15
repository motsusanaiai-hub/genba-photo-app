import { describe, expect, it, vi } from 'vitest'
import { PhotoDisplayController, type PhotoDisplayDeps, type PhotoDisplayState } from '@/lib/photoDisplayController'
import type { Photo } from '@/types/photo'

// ライトボックス・撮影オーバーレイ（共通の PhotoDisplayController）の画像読み込み失敗時のフォールバック。
//   端末内の画像（原本・サムネイル・圧縮画像）が <img> として表示できなかったら（onError）、Blob URL を解放して
//   次の段階へ進み、最後にクラウド（署名付きURL）を使う。クラウドの画像が失敗したら、URL を1度だけ作り直す。
// onError は handleError() の呼び出しで再現する。IndexedDB・クラウドはモック（外部には接続しない）。

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

interface Setup {
  original?: string | null
  compressed?: string | null | (() => Promise<string | null>)
  cloud?: string | null | (() => Promise<string | null>)
  refresh?: string | null | (() => Promise<string | null>)
  canAccess?: boolean
}
const resolveOf = (v: Setup['cloud'] | undefined, fallback: string | null) =>
  typeof v === 'function' ? v() : Promise.resolve(v === undefined ? fallback : v)

function harness(setup: Setup = {}) {
  const log = { original: 0, compressed: 0, cloud: 0, refresh: 0 }
  const revoked: string[] = []
  const deps: PhotoDisplayDeps = {
    getLocalObjectUrl: async () => (log.original++, setup.original ?? null),
    getLocalCompressedUrl: () => (log.compressed++, resolveOf(setup.compressed, null)),
    loadDisplayUrl: () => (log.cloud++, resolveOf(setup.cloud, 'https://signed.example/a')),
    refreshDisplayUrl: () => (log.refresh++, resolveOf(setup.refresh, 'https://signed.example/a2')),
    revokeObjectUrl: (u) => revoked.push(u),
    canAccess: () => setup.canAccess ?? true,
  }
  const states: PhotoDisplayState[] = []
  return { deps, log, revoked, states, onChange: (s: PhotoDisplayState) => states.push(s), get last() { return states[states.length - 1] } }
}
const photo = (extra: Partial<Photo> = {}) =>
  ({ id: 'a', user_id: 'user-a', thumbnail_data_url: '', storage_path: 'user-a/a.jpg', ...extra }) as Photo

describe('IndexedDB の圧縮画像が <img> として表示できないとき', () => {
  it('正常に表示できるなら、クラウドへアクセスしない', async () => {
    const h = harness({ compressed: 'blob:c' })
    await new PhotoDisplayController(photo(), h.deps, h.onChange).load()
    expect(h.last.url).toBe('blob:c')
    expect(h.log.cloud).toBe(0)
    expect(h.log.refresh).toBe(0)
    expect(h.revoked).toEqual([])
  })

  it('読み込みに失敗したら、Blob URL を解放してクラウド画像に切り替える', async () => {
    const h = harness({ compressed: 'blob:c' })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    await c.handleError() // <img onError>
    expect(h.revoked).toEqual(['blob:c'])
    expect(h.last).toEqual({ url: 'https://signed.example/a', loading: false, localOriginal: false })
    expect(h.log.cloud).toBe(1)
    // 切り替え後の dispose で、同じ URL をもう一度解放しない（古い Blob URL を保持していない）
    c.dispose()
    expect(h.revoked).toEqual(['blob:c'])
  })

  it('切り替え中（クラウド取得中）は、壊れた画像ではなく読み込み中の表示になる', async () => {
    const d = deferred<string | null>()
    const h = harness({ compressed: 'blob:c', cloud: () => d.promise })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    const fallback = c.handleError()
    await flush()
    expect(h.last).toEqual({ url: null, loading: true, localOriginal: false })
    d.resolve('https://signed.example/late')
    await fallback
    expect(h.last.url).toBe('https://signed.example/late')
  })

  it('storage_path が null なら、クラウドへアクセスせず、表示できない状態になる（Blob URL は解放）', async () => {
    const h = harness({ compressed: 'blob:c' })
    const c = new PhotoDisplayController(photo({ storage_path: null }), h.deps, h.onChange)
    await c.load()
    await c.handleError()
    expect(h.log.cloud).toBe(0)
    expect(h.log.refresh).toBe(0)
    expect(h.revoked).toEqual(['blob:c'])
    expect(h.last).toEqual({ url: null, loading: false, localOriginal: false })
  })
})

describe('クラウド画像も表示できないとき', () => {
  it('クラウドの署名付きURLを取得できなければ、代替表示（url=null）になる', async () => {
    const h = harness({ compressed: 'blob:c', cloud: null })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    await c.handleError()
    expect(h.last).toEqual({ url: null, loading: false, localOriginal: false })
  })

  it('クラウド画像の <img> が失敗したら、署名付きURLの作り直しは最大1回で止まる', async () => {
    const h = harness({ compressed: 'blob:c' })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    await c.handleError() // ローカル失敗 → クラウド
    await c.handleError() // クラウド失敗 → 作り直し（1回目）
    expect(h.log.refresh).toBe(1)
    expect(h.last.url).toBe('https://signed.example/a2')
    await c.handleError() // 作り直した画像も失敗 → 表示しない
    await c.handleError()
    expect(h.log.refresh).toBe(1)
    expect(h.log.cloud).toBe(1)
    expect(h.last).toEqual({ url: null, loading: false, localOriginal: false })
  })

  it('ローカル画像の失敗と、クラウド画像の失敗を区別する（ローカル失敗では作り直しをしない）', async () => {
    const h = harness({ compressed: 'blob:c' })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    await c.handleError()
    expect(h.log.refresh).toBe(0)
  })
})

describe('優先順位（原本 → サムネイル → 圧縮画像 → クラウド）', () => {
  it('原本があれば原本。圧縮画像・クラウドへは行かない', async () => {
    const h = harness({ original: 'blob:o', compressed: 'blob:c' })
    await new PhotoDisplayController(photo(), h.deps, h.onChange).load()
    expect(h.last.url).toBe('blob:o')
    expect(h.log).toMatchObject({ original: 1, compressed: 0, cloud: 0 })
  })

  it('原本が表示できなければ、サムネイル → 圧縮画像 → クラウドの順に、残りの画像で表示する', async () => {
    const h = harness({ original: 'blob:o', compressed: 'blob:c' })
    const c = new PhotoDisplayController(photo({ thumbnail_data_url: 'data:thumb' }), h.deps, h.onChange)
    await c.load()
    expect(h.last.url).toBe('blob:o')
    await c.handleError()
    expect(h.last.url).toBe('data:thumb') // サムネイル
    expect(h.revoked).toEqual(['blob:o'])
    await c.handleError()
    expect(h.last.url).toBe('blob:c') // 圧縮画像
    expect(h.log.compressed).toBe(1)
    await c.handleError()
    expect(h.last.url).toBe('https://signed.example/a') // クラウド
    expect(h.revoked).toEqual(['blob:o', 'blob:c'])
    expect(h.log.cloud).toBe(1)
  })

  it('画像が1つも無く storage_path も無ければ、何にもアクセスせず代替表示', async () => {
    const h = harness()
    await new PhotoDisplayController(photo({ storage_path: null }), h.deps, h.onChange).load()
    expect(h.last).toEqual({ url: null, loading: false, localOriginal: false })
    expect(h.log.cloud).toBe(0)
  })
})

describe('所有者確認（H-1）', () => {
  it('所有者確認に失敗したら、ローカル（原本・圧縮画像）もクラウドも読まず、onError でも何も読まない', async () => {
    const h = harness({ original: 'blob:o', compressed: 'blob:c', canAccess: false })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    await c.handleError()
    expect(h.log).toEqual({ original: 0, compressed: 0, cloud: 0, refresh: 0 })
    expect(h.last).toEqual({ url: null, loading: false, localOriginal: false })
  })
})

describe('写真の切り替え・画面終了（M-1）', () => {
  it('A→B：Aのフォールバック（クラウド取得）が後から完了しても、Aを表示しない', async () => {
    const d = deferred<string | null>()
    const a = harness({ compressed: 'blob:a', cloud: () => d.promise })
    const ca = new PhotoDisplayController(photo({ id: 'A' }), a.deps, a.onChange)
    await ca.load()
    const fallback = ca.handleError() // Aのクラウド取得を開始
    await flush()
    ca.dispose() // Bへ切り替え
    const states: PhotoDisplayState[] = []
    const b = harness({ compressed: 'blob:b' })
    const cb = new PhotoDisplayController(photo({ id: 'B' }), b.deps, (s) => states.push(s))
    await cb.load()
    d.resolve('https://signed.example/stale-A')
    await fallback
    expect(a.states.some((s) => s.url === 'https://signed.example/stale-A')).toBe(false)
    expect(states.at(-1)?.url).toBe('blob:b')
    expect(a.revoked).toEqual(['blob:a']) // 二重に解放しない
  })

  it('A→B→A：古いAのフォールバック結果は使わない', async () => {
    const d = deferred<string | null>()
    const first = harness({ compressed: 'blob:a1', cloud: () => d.promise })
    const c1 = new PhotoDisplayController(photo(), first.deps, first.onChange)
    await c1.load()
    const fallback = c1.handleError()
    await flush()
    c1.dispose()
    const second = harness({ compressed: 'blob:a2' })
    const c2 = new PhotoDisplayController(photo(), second.deps, second.onChange)
    await c2.load()
    d.resolve('https://signed.example/stale')
    await fallback
    expect(first.states.some((s) => s.url === 'https://signed.example/stale')).toBe(false)
    expect(second.last.url).toBe('blob:a2')
  })

  it('フォールバック中に画面を閉じたら（アンマウント／参照写真の選択解除）、状態を更新しない', async () => {
    const d = deferred<string | null>()
    const h = harness({ compressed: 'blob:c', cloud: () => d.promise })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    await c.load()
    const fallback = c.handleError()
    await flush()
    const count = h.states.length
    c.dispose()
    d.resolve('https://signed.example/late')
    await fallback
    expect(h.states.length).toBe(count)
    await c.handleError() // 閉じた後の onError も無視
    expect(h.states.length).toBe(count)
    expect(h.revoked).toEqual(['blob:c'])
  })

  it('圧縮画像の読み込み中に写真が切り替わっても、古い Blob URL を解放し、表示しない', async () => {
    const d = deferred<string | null>()
    const h = harness({ compressed: () => d.promise })
    const c = new PhotoDisplayController(photo(), h.deps, h.onChange)
    const loading = c.load()
    await flush()
    c.dispose()
    d.resolve('blob:stale')
    await loading
    expect(h.revoked).toEqual(['blob:stale'])
    expect(h.states.some((s) => s.url === 'blob:stale')).toBe(false)
  })

  it('StrictMode（作成→dispose→再作成）でも、フォールバックが正しく動く', async () => {
    const h1 = harness({ compressed: 'blob:first' })
    const first = new PhotoDisplayController(photo(), h1.deps, h1.onChange)
    void first.load()
    first.dispose()
    const h2 = harness({ compressed: 'blob:second' })
    const second = new PhotoDisplayController(photo(), h2.deps, h2.onChange)
    await second.load()
    await second.handleError()
    expect(h2.revoked).toEqual(['blob:second'])
    expect(h2.last.url).toBe('https://signed.example/a')
  })
})

describe('ライトボックスと撮影オーバーレイで共通の処理を使う', () => {
  it('どちらも usePhotoDisplay の handleError を <img onError> に渡している', async () => {
    const { readFileSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const root = nodePath.resolve(__dirname, '../..')
    for (const file of ['src/components/photo/PhotoLightbox.tsx', 'src/components/photo/OverlayCameraView.tsx']) {
      const src = readFileSync(nodePath.join(root, file), 'utf8')
      expect(src).toContain('usePhotoDisplay(')
      expect(src).toMatch(/onError=\{handle(Image|Overlay)Error\}/)
    }
  })
})

void vi
