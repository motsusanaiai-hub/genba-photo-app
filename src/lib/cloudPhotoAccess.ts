/**
 * クラウド上の圧縮写真（Supabase Storage）を、本人の認証で取得する共通処理。
 *
 * 公開URL（getPublicUrl）には依存しない。Storage が public でも private でも同じコードで動く：
 *   - 画面の表示 … 署名付きURL（createSignedUrls）をまとめて取得し、メモリにだけキャッシュする
 *   - ZIP・Excel の出力 … 認証付きダウンロード（download）。有効期限の影響を受けないよう、URLは使わない
 * どちらも利用者本人のJWTで呼ぶ（service_role は使わない）。取得できるかは Storage の SELECT ポリシー次第。
 *
 * 署名付きURLの扱い：
 *   - localStorage / IndexedDB には保存しない（メモリのみ）。
 *   - キャッシュのキーは「ユーザーID + storage_path」。別ユーザーのURLと混ざらない。
 *   - 有効期限の少し前（REFRESH_MARGIN）になったら、次の取得時に作り直す。画像の読み込みに失敗したときは
 *     forceRefresh で作り直せる。
 *   - ログアウト・ユーザー切り替えでは clear() で全て破棄する。破棄前に始まった取得の結果は、キャッシュに入れない。
 *   - 同じ写真への同時要求は1回にまとめ、複数の写真は BATCH_SIZE 件ずつ createSignedUrls にまとめて送る。
 *     同時に走らせるバッチ数・ダウンロード数には上限がある。
 *   - 取得に失敗した写真は、しばらく（FAILURE_BACKOFF）再要求しない。画面の再描画のたびに通信しないため。
 *
 * このファイルは Supabase や React を import しない（依存は options で受け取る）。単体でテストできる。
 */

/** 署名付きURLの有効期限（秒） */
export const SIGNED_URL_TTL_SEC = 3600
/** 有効期限のこの秒数前になったら、使わずに作り直す */
export const REFRESH_MARGIN_SEC = 300
/** createSignedUrls に1回で渡す最大件数 */
export const BATCH_SIZE = 100
/** 同時に実行する createSignedUrls の最大数 */
export const MAX_CONCURRENT_BATCHES = 2
/** 同時に実行する download の最大数 */
export const MAX_CONCURRENT_DOWNLOADS = 4
/** 取得に失敗した写真を、再要求しない時間（ミリ秒） */
export const FAILURE_BACKOFF_MS = 15_000
/** download の再試行回数（通信エラー・サーバーエラーのときだけ） */
export const DOWNLOAD_RETRIES = 1
export const DOWNLOAD_RETRY_DELAY_MS = 300

export interface SignedUrlItem {
  path: string | null
  signedUrl: string | null
  error: string | null
}

/** supabase.storage.from(bucket) のうち、ここで使う部分 */
export interface CloudStorageApi {
  createSignedUrls(
    paths: string[],
    expiresInSec: number,
  ): Promise<{ data: SignedUrlItem[] | null; error: unknown }>
  download(path: string): Promise<{ data: Blob | null; error: unknown }>
}

export interface CloudPhotoAccessOptions {
  storage: CloudStorageApi
  /** 現在ログインしているユーザーID（未ログインは null） */
  getUserId: () => string | null
  now?: () => number
  /** バッチ取得のまとめ待ち。既定は次のタスク（同じ画面描画で出た要求を1回にまとめる） */
  defer?: (task: () => void) => void
  sleep?: (ms: number) => Promise<void>
  ttlSec?: number
  refreshMarginSec?: number
  batchSize?: number
  maxConcurrentBatches?: number
  maxConcurrentDownloads?: number
  failureBackoffMs?: number
  downloadRetries?: number
}

export interface CachedSignedUrl {
  url: string
  /** この時刻（ミリ秒）に失効する */
  expiresAt: number
}

/** 同時実行数を制限する小さな待ち行列 */
class Limiter {
  private running = 0
  private waiting: Array<() => void> = []
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try {
      return await task()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }
}

interface QueuedRequest {
  userId: string
  path: string
  waiters: Array<(url: string | null) => void>
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  const value = typeof status === 'number' ? status : typeof statusCode === 'string' ? Number(statusCode) : statusCode
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export class CloudPhotoAccess {
  private readonly storage: CloudStorageApi
  private readonly getUserId: () => string | null
  private readonly now: () => number
  private readonly defer: (task: () => void) => void
  private readonly sleep: (ms: number) => Promise<void>
  private readonly ttlSec: number
  private readonly refreshMarginMs: number
  private readonly batchSize: number
  private readonly failureBackoffMs: number
  private readonly downloadRetries: number
  private readonly batchLimiter: Limiter
  private readonly downloadLimiter: Limiter

  private cache = new Map<string, CachedSignedUrl>()
  private inflight = new Map<string, Promise<string | null>>()
  private failedUntil = new Map<string, number>()
  private queue = new Map<string, QueuedRequest>()
  private flushScheduled = false
  /** clear() のたびに増える世代。古い世代の取得結果は、キャッシュに入れず、呼び出し元にも返さない */
  private generation = 0

  constructor(options: CloudPhotoAccessOptions) {
    this.storage = options.storage
    this.getUserId = options.getUserId
    this.now = options.now ?? (() => Date.now())
    this.defer = options.defer ?? ((task) => void setTimeout(task, 0))
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.ttlSec = options.ttlSec ?? SIGNED_URL_TTL_SEC
    this.refreshMarginMs = (options.refreshMarginSec ?? REFRESH_MARGIN_SEC) * 1000
    this.batchSize = options.batchSize ?? BATCH_SIZE
    this.failureBackoffMs = options.failureBackoffMs ?? FAILURE_BACKOFF_MS
    this.downloadRetries = options.downloadRetries ?? DOWNLOAD_RETRIES
    this.batchLimiter = new Limiter(options.maxConcurrentBatches ?? MAX_CONCURRENT_BATCHES)
    this.downloadLimiter = new Limiter(options.maxConcurrentDownloads ?? MAX_CONCURRENT_DOWNLOADS)
  }

  private key(userId: string, path: string): string {
    return `${userId}\n${path}`
  }

  /** 通信せず、有効期限に余裕のあるキャッシュだけを返す（画面の初回表示に使う） */
  peek(path: string): CachedSignedUrl | null {
    const userId = this.getUserId()
    if (!userId || !path) return null
    const entry = this.cache.get(this.key(userId, path))
    return entry && entry.expiresAt - this.now() > this.refreshMarginMs ? entry : null
  }

  /** 失効の少し前に呼ぶ予定時刻（画面が自動で更新するための目安）。キャッシュが無ければ null */
  refreshAt(path: string): number | null {
    const userId = this.getUserId()
    const entry = userId ? this.cache.get(this.key(userId, path)) : undefined
    return entry ? entry.expiresAt - this.refreshMarginMs : null
  }

  /**
   * 署名付きURLを返す。取得できなければ null（例外は投げない）。
   * 有効なキャッシュがあれば通信しない。forceRefresh は、画像の読み込みに失敗した後の作り直し用。
   */
  getSignedUrl(path: string, options: { forceRefresh?: boolean } = {}): Promise<string | null> {
    const userId = this.getUserId()
    if (!userId || !path) return Promise.resolve(null)
    const key = this.key(userId, path)

    if (options.forceRefresh) {
      this.cache.delete(key)
      this.failedUntil.delete(key)
    } else {
      const cached = this.peek(path)
      if (cached) return Promise.resolve(cached.url)
      if ((this.failedUntil.get(key) ?? 0) > this.now()) return Promise.resolve(null)
    }

    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = new Promise<string | null>((resolve) => {
      const queued = this.queue.get(key)
      if (queued) queued.waiters.push(resolve)
      else this.queue.set(key, { userId, path, waiters: [resolve] })
    })
    const tracked = promise.finally(() => {
      if (this.inflight.get(key) === tracked) this.inflight.delete(key)
    })
    this.inflight.set(key, tracked)
    this.scheduleFlush()
    return tracked
  }

  private scheduleFlush() {
    if (this.flushScheduled) return
    this.flushScheduled = true
    this.defer(() => {
      this.flushScheduled = false
      void this.flush()
    })
  }

  private async flush() {
    const requests = [...this.queue.values()]
    this.queue = new Map()
    if (requests.length === 0) return
    const generation = this.generation

    const chunks: QueuedRequest[][] = []
    for (let i = 0; i < requests.length; i += this.batchSize) chunks.push(requests.slice(i, i + this.batchSize))
    await Promise.all(chunks.map((chunk) => this.batchLimiter.run(() => this.signChunk(chunk, generation))))
  }

  private async signChunk(chunk: QueuedRequest[], generation: number) {
    const requestedAt = this.now()
    let items: SignedUrlItem[] | null = null
    try {
      const { data, error } = await this.storage.createSignedUrls(
        chunk.map((r) => r.path),
        this.ttlSec,
      )
      if (!error) items = data
    } catch {
      items = null
    }

    const byPath = new Map<string, SignedUrlItem>()
    for (const item of items ?? []) if (item.path) byPath.set(item.path, item)

    const stale = generation !== this.generation
    for (const request of chunk) {
      const key = this.key(request.userId, request.path)
      const item = byPath.get(request.path)
      const ok = !stale && !!item?.signedUrl && !item.error && this.getUserId() === request.userId
      if (ok && item?.signedUrl) {
        this.cache.set(key, { url: item.signedUrl, expiresAt: requestedAt + this.ttlSec * 1000 })
        this.failedUntil.delete(key)
        for (const resolve of request.waiters) resolve(item.signedUrl)
      } else {
        // ログアウト・ユーザー切り替え後の結果は、返さない・保存しない
        if (!stale) this.failedUntil.set(key, this.now() + this.failureBackoffMs)
        for (const resolve of request.waiters) resolve(null)
      }
    }
  }

  /**
   * 認証付きでダウンロードする（ZIP・Excel の出力用。署名付きURLの有効期限に左右されない）。
   * 通信エラー・サーバーエラーは少しだけ再試行する。権限エラー・存在しない場合は再試行しない。
   * 取得できなければ null（例外は投げない）。
   */
  async downloadBlob(path: string): Promise<Blob | null> {
    const userId = this.getUserId()
    if (!userId || !path) return null
    const generation = this.generation

    return this.downloadLimiter.run(async () => {
      for (let attempt = 0; attempt <= this.downloadRetries; attempt++) {
        if (generation !== this.generation || this.getUserId() !== userId) return null
        try {
          const { data, error } = await this.storage.download(path)
          if (data && !error) return generation === this.generation && this.getUserId() === userId ? data : null
          const status = statusOf(error)
          const retryable = status === undefined || status >= 500
          if (!retryable) return null
        } catch {
          // 通信の例外は再試行の対象
        }
        if (attempt < this.downloadRetries) await this.sleep(DOWNLOAD_RETRY_DELAY_MS)
      }
      return null
    })
  }

  /** 写真・工事案件の削除のとき、該当するパスのキャッシュを捨てる（どのユーザー分でも） */
  evict(paths: readonly string[]) {
    const targets = new Set(paths)
    for (const map of [this.cache, this.failedUntil] as Array<Map<string, unknown>>) {
      for (const key of [...map.keys()]) {
        if (targets.has(key.slice(key.indexOf('\n') + 1))) map.delete(key)
      }
    }
  }

  /** ログアウト・ユーザー切り替え：キャッシュと待ち行列を全て破棄する */
  clear() {
    this.generation++
    this.cache.clear()
    this.failedUntil.clear()
    this.inflight.clear()
    const waiting = [...this.queue.values()]
    this.queue = new Map()
    for (const request of waiting) for (const resolve of request.waiters) resolve(null)
  }
}
