import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BATCH_SIZE,
  CloudPhotoAccess,
  FAILURE_BACKOFF_MS,
  MAX_CONCURRENT_BATCHES,
  MAX_CONCURRENT_DOWNLOADS,
  REFRESH_MARGIN_SEC,
  SIGNED_URL_TTL_SEC,
  type CloudStorageApi,
  type SignedUrlItem,
} from '@/lib/cloudPhotoAccess'

// クラウド画像の取得（署名付きURL・認証付きダウンロード）。Supabase はフェイク（外部サービスには接続しない）。

const ROOT = nodePath.resolve(__dirname, '../..')
const HOUR = 3600 * 1000

function setup(options: { failPaths?: Set<string>; batchDelay?: number; batchSize?: number } = {}) {
  let userId: string | null = 'user-a'
  let clock = 1_000_000
  let signCounter = 0
  const signCalls: string[][] = []
  let activeBatches = 0
  let maxActiveBatches = 0
  let activeDownloads = 0
  let maxActiveDownloads = 0

  const download = vi.fn(async (p: string) => {
    activeDownloads++
    maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads)
    await new Promise((r) => setTimeout(r, 1))
    activeDownloads--
    return { data: new Blob([p]) as Blob | null, error: null as unknown }
  })

  const storage: CloudStorageApi = {
    async createSignedUrls(paths, expiresInSec) {
      expect(expiresInSec).toBe(SIGNED_URL_TTL_SEC)
      signCalls.push([...paths])
      activeBatches++
      maxActiveBatches = Math.max(maxActiveBatches, activeBatches)
      await new Promise((r) => setTimeout(r, options.batchDelay ?? 0))
      activeBatches--
      const data: SignedUrlItem[] = paths.map((p) =>
        options.failPaths?.has(p)
          ? { path: p, signedUrl: null, error: 'Object not found' }
          : { path: p, signedUrl: `https://signed.example/${p}?token=${++signCounter}`, error: null },
      )
      return { data, error: null }
    },
    download,
  }

  const access = new CloudPhotoAccess({
    storage,
    getUserId: () => userId,
    now: () => clock,
    defer: (task) => queueMicrotask(task),
    sleep: async () => {},
    batchSize: options.batchSize,
  })
  return {
    access,
    download,
    signCalls,
    setUser: (id: string | null) => {
      userId = id
    },
    advance: (ms: number) => {
      clock += ms
    },
    maxActiveBatches: () => maxActiveBatches,
    maxActiveDownloads: () => maxActiveDownloads,
  }
}

const photoPath = (n: number) => `user-a/photo-${n}.jpg`

describe('署名付きURLの取得とキャッシュ', () => {
  it('署名付きURLを取得して返す（有効期限は1時間）', async () => {
    const { access, signCalls } = setup()
    const url = await access.getSignedUrl(photoPath(1))
    expect(url).toMatch(/^https:\/\/signed\.example\/user-a\/photo-1\.jpg\?token=/)
    expect(signCalls).toEqual([[photoPath(1)]])
    expect(SIGNED_URL_TTL_SEC).toBe(3600)
  })

  it('有効なキャッシュがあれば、通信せずに同じURLを返す', async () => {
    const { access, signCalls } = setup()
    const first = await access.getSignedUrl(photoPath(1))
    const second = await access.getSignedUrl(photoPath(1))
    expect(second).toBe(first)
    expect(signCalls).toHaveLength(1)
  })

  it('同じ写真への同時の要求は、1回の取得にまとめる', async () => {
    const { access, signCalls } = setup()
    const results = await Promise.all([
      access.getSignedUrl(photoPath(1)),
      access.getSignedUrl(photoPath(1)),
      access.getSignedUrl(photoPath(1)),
    ])
    expect(new Set(results).size).toBe(1)
    expect(signCalls).toEqual([[photoPath(1)]])
  })

  it('peek は通信せず、有効なキャッシュだけを返す', async () => {
    const { access, signCalls } = setup()
    expect(access.peek(photoPath(1))).toBeNull()
    expect(signCalls).toHaveLength(0)
    const url = await access.getSignedUrl(photoPath(1))
    expect(access.peek(photoPath(1))?.url).toBe(url)
    expect(signCalls).toHaveLength(1)
  })

  it('未ログイン、空のパスでは通信せず null', async () => {
    const { access, signCalls, setUser } = setup()
    setUser(null)
    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    setUser('user-a')
    expect(await access.getSignedUrl('')).toBeNull()
    expect(signCalls).toHaveLength(0)
  })
})

describe('有効期限・更新・再取得', () => {
  it('期限の少し前（REFRESH_MARGIN）になったら、使わずに新しいURLを取得する', async () => {
    const { access, signCalls, advance } = setup()
    const first = await access.getSignedUrl(photoPath(1))

    advance(HOUR - REFRESH_MARGIN_SEC * 1000 - 1000) // まだ余裕がある
    expect(await access.getSignedUrl(photoPath(1))).toBe(first)
    expect(signCalls).toHaveLength(1)

    advance(2000) // 余裕を下回った
    const renewed = await access.getSignedUrl(photoPath(1))
    expect(renewed).not.toBe(first)
    expect(signCalls).toHaveLength(2)
  })

  it('期限が完全に切れたURLも、新しく取得する', async () => {
    const { access, advance } = setup()
    const first = await access.getSignedUrl(photoPath(1))
    advance(HOUR * 3)
    expect(await access.getSignedUrl(photoPath(1))).not.toBe(first)
  })

  it('peek も、期限が近いキャッシュは返さない', async () => {
    const { access, advance } = setup()
    await access.getSignedUrl(photoPath(1))
    advance(HOUR - REFRESH_MARGIN_SEC * 1000 + 1000)
    expect(access.peek(photoPath(1))).toBeNull()
  })

  it('refreshAt は、更新の目安時刻（期限の MARGIN 前）を返す', async () => {
    const { access } = setup()
    expect(access.refreshAt(photoPath(1))).toBeNull()
    await access.getSignedUrl(photoPath(1))
    expect(access.refreshAt(photoPath(1))).toBe(1_000_000 + HOUR - REFRESH_MARGIN_SEC * 1000)
  })

  it('画像の読み込みに失敗した後の forceRefresh は、キャッシュがあっても作り直す', async () => {
    const { access, signCalls } = setup()
    const first = await access.getSignedUrl(photoPath(1))
    const refreshed = await access.getSignedUrl(photoPath(1), { forceRefresh: true })
    expect(refreshed).not.toBe(first)
    expect(signCalls).toHaveLength(2)
    // 作り直したURLが、以降のキャッシュになる
    expect(await access.getSignedUrl(photoPath(1))).toBe(refreshed)
    expect(signCalls).toHaveLength(2)
  })
})

describe('ユーザー切り替え・ログアウト', () => {
  it('キャッシュはユーザーごと。別のユーザーに切り替えても、前のユーザーのURLを返さない', async () => {
    const { access, signCalls, setUser } = setup()
    const forA = await access.getSignedUrl(photoPath(1))
    setUser('user-b')
    expect(access.peek(photoPath(1))).toBeNull()
    const forB = await access.getSignedUrl(photoPath(1))
    expect(forB).not.toBe(forA)
    expect(signCalls).toHaveLength(2)
    setUser('user-a')
    expect(await access.getSignedUrl(photoPath(1))).toBe(forA) // 同じユーザーに戻れば、そのユーザー分は残っている
  })

  it('clear()（ログアウト）で全て破棄され、次は取得し直す', async () => {
    const { access, signCalls } = setup()
    await access.getSignedUrl(photoPath(1))
    access.clear()
    expect(access.peek(photoPath(1))).toBeNull()
    await access.getSignedUrl(photoPath(1))
    expect(signCalls).toHaveLength(2)
  })

  it('取得の最中にログアウト（clear）した場合、その結果は返さず、キャッシュにも入れない', async () => {
    const { access, signCalls } = setup({ batchDelay: 10 })
    const pending = access.getSignedUrl(photoPath(1))
    await Promise.resolve()
    await Promise.resolve() // バッチの通信が始まった
    expect(signCalls).toHaveLength(1)
    access.clear()
    expect(await pending).toBeNull()
    expect(access.peek(photoPath(1))).toBeNull()
  })

  it('まだ送信されていない待ち行列の要求も、clear で破棄される（通信しない）', async () => {
    const { access, signCalls } = setup()
    const pending = access.getSignedUrl(photoPath(1))
    access.clear()
    expect(await pending).toBeNull()
    await new Promise((r) => setTimeout(r, 5))
    expect(signCalls).toHaveLength(0)
  })

  it('取得の最中にユーザーが替わったら（別ユーザーのURLになってしまう前に）結果を捨てる', async () => {
    const { access, setUser } = setup({ batchDelay: 10 })
    const pending = access.getSignedUrl(photoPath(1))
    await Promise.resolve()
    await Promise.resolve()
    setUser('user-b')
    expect(await pending).toBeNull()
    expect(access.peek(photoPath(1))).toBeNull()
  })
})

describe('写真・工事案件の削除', () => {
  it('evict は該当するパスのキャッシュだけを捨てる', async () => {
    const { access, signCalls } = setup()
    const a = await access.getSignedUrl(photoPath(1))
    const b = await access.getSignedUrl(photoPath(2))
    access.evict([photoPath(1)])
    expect(access.peek(photoPath(1))).toBeNull()
    expect(access.peek(photoPath(2))?.url).toBe(b)
    const a2 = await access.getSignedUrl(photoPath(1))
    expect(a2).not.toBe(a)
    expect(signCalls).toHaveLength(3)
  })

  it('取得に失敗して待機中の写真も、evict で待機が解除され、すぐ再要求できる', async () => {
    const failing = new Set([photoPath(1)])
    const { access, signCalls } = setup({ failPaths: failing })
    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    expect(signCalls).toHaveLength(1)
    access.evict([photoPath(1)])
    failing.delete(photoPath(1))
    expect(await access.getSignedUrl(photoPath(1))).toMatch(/^https:/)
    expect(signCalls).toHaveLength(2)
  })
})

describe('大量の写真（バッチ取得・同時実行数の制御）', () => {
  it('複数の写真の要求は、1回の createSignedUrls にまとめる', async () => {
    const { access, signCalls } = setup()
    const urls = await Promise.all([1, 2, 3, 4, 5].map((n) => access.getSignedUrl(photoPath(n))))
    expect(urls.every((u) => typeof u === 'string')).toBe(true)
    expect(signCalls).toHaveLength(1)
    expect(signCalls[0]).toHaveLength(5)
  })

  it('250枚 → 100 + 100 + 50 の3回に分けて取得し、全て返る（1枚ずつ無制限にAPIを呼ばない）', async () => {
    const { access, signCalls } = setup()
    const urls = await Promise.all(Array.from({ length: 250 }, (_, i) => access.getSignedUrl(photoPath(i))))
    expect(urls.every((u) => typeof u === 'string')).toBe(true)
    expect(new Set(urls).size).toBe(250)
    expect(signCalls.map((c) => c.length).sort((a, b) => b - a)).toEqual([100, 100, 50])
    expect(BATCH_SIZE).toBe(100)
  })

  it('100枚以上（120枚）でも、2回のバッチで取得できる', async () => {
    const { access, signCalls } = setup()
    await Promise.all(Array.from({ length: 120 }, (_, i) => access.getSignedUrl(photoPath(i))))
    expect(signCalls.map((c) => c.length).sort((a, b) => b - a)).toEqual([100, 20])
  })

  it('同時に実行するバッチ数に上限がある（MAX_CONCURRENT_BATCHES）', async () => {
    const { access, signCalls, maxActiveBatches } = setup({ batchDelay: 5, batchSize: 10 })
    await Promise.all(Array.from({ length: 100 }, (_, i) => access.getSignedUrl(photoPath(i))))
    expect(signCalls).toHaveLength(10)
    expect(maxActiveBatches()).toBeLessThanOrEqual(MAX_CONCURRENT_BATCHES)
    expect(maxActiveBatches()).toBeGreaterThan(0)
  })

  it('一部の写真の取得に失敗しても、他の写真は取得できる', async () => {
    const failing = new Set([photoPath(2), photoPath(4)])
    const { access } = setup({ failPaths: failing })
    const urls = await Promise.all([1, 2, 3, 4, 5].map((n) => access.getSignedUrl(photoPath(n))))
    expect(urls.map((u) => u === null)).toEqual([false, true, false, true, false])
  })

  it('失敗した写真は、しばらく再要求しない（再描画のたびに通信しない）。時間が過ぎれば再試行する', async () => {
    const failing = new Set([photoPath(1)])
    const { access, signCalls, advance } = setup({ failPaths: failing })
    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    expect(signCalls).toHaveLength(1)

    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    expect(signCalls).toHaveLength(1) // 待機中は通信しない

    advance(FAILURE_BACKOFF_MS + 1)
    failing.delete(photoPath(1)) // 写真が取得できる状態になった
    expect(await access.getSignedUrl(photoPath(1))).toMatch(/^https:/)
    expect(signCalls).toHaveLength(2)
  })

  it('forceRefresh は、失敗の待機中でもすぐ再取得する', async () => {
    const failing = new Set([photoPath(1)])
    const { access, signCalls } = setup({ failPaths: failing })
    expect(await access.getSignedUrl(photoPath(1))).toBeNull()
    failing.delete(photoPath(1))
    expect(await access.getSignedUrl(photoPath(1), { forceRefresh: true })).toMatch(/^https:/)
    expect(signCalls).toHaveLength(2)
  })

  it('取得の通信全体が失敗（エラー・例外）しても例外を投げず、全て null', async () => {
    const download = vi.fn(async () => ({ data: null, error: null }))
    const errorAccess = new CloudPhotoAccess({
      storage: { createSignedUrls: async () => ({ data: null, error: { message: 'boom' } }), download },
      getUserId: () => 'user-a',
      defer: (task) => queueMicrotask(task),
    })
    expect(await Promise.all([errorAccess.getSignedUrl(photoPath(1)), errorAccess.getSignedUrl(photoPath(2))])).toEqual([
      null,
      null,
    ])

    const throwAccess = new CloudPhotoAccess({
      storage: {
        createSignedUrls: async () => {
          throw new TypeError('fetch failed')
        },
        download,
      },
      getUserId: () => 'user-a',
      defer: (task) => queueMicrotask(task),
    })
    expect(await throwAccess.getSignedUrl(photoPath(1))).toBeNull()
  })
})

describe('ZIP・Excel 用の認証付きダウンロード', () => {
  it('認証付きで取得して Blob を返す（署名付きURLの有効期限に左右されない）', async () => {
    const { access, download, signCalls } = setup()
    const blob = await access.downloadBlob(photoPath(1))
    expect(blob).toBeInstanceOf(Blob)
    expect(download).toHaveBeenCalledWith(photoPath(1))
    expect(signCalls).toHaveLength(0)
  })

  it('未ログイン、空のパスでは取得しない', async () => {
    const { access, download, setUser } = setup()
    setUser(null)
    expect(await access.downloadBlob(photoPath(1))).toBeNull()
    setUser('user-a')
    expect(await access.downloadBlob('')).toBeNull()
    expect(download).not.toHaveBeenCalled()
  })

  it.each([
    ['存在しない（404）', { status: 404 }],
    ['権限がない（403）', { status: 403 }],
    ['不正な要求（400）', { status: 400 }],
  ])('%s → 再試行せず null', async (_label, error) => {
    const { access, download } = setup()
    download.mockResolvedValue({ data: null, error })
    expect(await access.downloadBlob(photoPath(1))).toBeNull()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('サーバーエラー（500）や通信の例外は、1回だけ再試行する。再試行で成功すれば Blob を返す', async () => {
    const { access, download } = setup()
    download.mockResolvedValueOnce({ data: null, error: { status: 500 } })
    expect(await access.downloadBlob(photoPath(1))).toBeInstanceOf(Blob)
    expect(download).toHaveBeenCalledTimes(2)

    download.mockReset()
    download.mockRejectedValueOnce(new TypeError('fetch failed'))
    download.mockResolvedValueOnce({ data: new Blob(['x']), error: null })
    expect(await access.downloadBlob(photoPath(2))).toBeInstanceOf(Blob)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('通信失敗が続いたら null（例外にせず、再試行も1回まで）', async () => {
    const { access, download } = setup()
    download.mockResolvedValue({ data: null, error: { status: 503 } })
    expect(await access.downloadBlob(photoPath(1))).toBeNull()
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('同時に実行するダウンロード数に上限がある（MAX_CONCURRENT_DOWNLOADS）', async () => {
    const { access, maxActiveDownloads } = setup()
    const blobs = await Promise.all(Array.from({ length: 30 }, (_, i) => access.downloadBlob(photoPath(i))))
    expect(blobs.every((b) => b instanceof Blob)).toBe(true)
    expect(maxActiveDownloads()).toBeLessThanOrEqual(MAX_CONCURRENT_DOWNLOADS)
    expect(maxActiveDownloads()).toBeGreaterThan(1)
  })

  it('取得の最中にログアウト・ユーザー切り替えをしたら、結果を返さない', async () => {
    const first = setup()
    const pending = first.access.downloadBlob(photoPath(1))
    first.setUser('user-b')
    expect(await pending).toBeNull()

    const second = setup()
    const pending2 = second.access.downloadBlob(photoPath(1))
    second.access.clear()
    expect(await pending2).toBeNull()
  })
})

describe('保存と公開URLについての制約', () => {
  const strip = (file: string) =>
    readFileSync(nodePath.join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1')

  it('署名付きURLを localStorage / sessionStorage / IndexedDB / cookie に保存しない（メモリのみ）', () => {
    for (const file of ['src/lib/cloudPhotoAccess.ts', 'src/lib/cloudPhotoCache.ts', 'src/lib/photoImageLoader.ts']) {
      expect(strip(file)).not.toMatch(/localStorage|sessionStorage|indexedDB|idb-keyval|document\.cookie/)
    }
  })

  it('公開URL（getPublicUrl）にも service_role にも依存しない', () => {
    for (const file of ['src/lib/cloudPhotoAccess.ts', 'src/lib/cloudPhotoCache.ts', 'src/lib/photoImageLoader.ts']) {
      expect(strip(file)).not.toMatch(/getPublicUrl|\/object\/public|service_role|SERVICE_ROLE/)
    }
  })
})
