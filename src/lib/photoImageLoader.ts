import type { CloudPhotoAccess } from '@/lib/cloudPhotoAccess'

/**
 * 1枚の写真の「表示用URL」を決める状態機械（React に依存しない。usePhotoImageSrc がつなぐ）。
 *
 *   1. 端末内の画像（thumbnail_data_url = base64）があれば、それを使う（通信しない）
 *   2. なければクラウドの圧縮画像を、本人の認証で取得した署名付きURLで表示する
 *        - 取得済みのURLが有効なら、最初の状態からそれを使う（通信しない）
 *        - 取得中は loading、取得できなければ failed
 *        - 失効の少し前（REFRESH_MARGIN）に自動でURLを作り直す
 *        - 画像の読み込みに失敗したとき（handleError）は、URLを1度だけ作り直す。それでも失敗なら failed
 *   3. どちらも無ければ（storage_path が null、未ログインなど）failed
 * 公開URLは使わない。
 */

export type PhotoImageStatus = 'ready' | 'loading' | 'failed'

export interface PhotoImageSnapshot {
  src: string | null
  status: PhotoImageStatus
}

export interface PhotoImageSource {
  /** 端末内の画像（base64）。あれば最優先 */
  local: string | null
  /** クラウドの圧縮画像のパス（storage_path） */
  path: string | null
  /** 現在のユーザーID（未ログインは null） */
  userId: string | null
}

type AccessApi = Pick<CloudPhotoAccess, 'peek' | 'getSignedUrl' | 'refreshAt'>

export interface PhotoImageLoaderDeps {
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** setTimeout の上限（約24.8日）を超えない範囲にする */
const MAX_TIMER_MS = 2 ** 31 - 1
/** 失効の直前に、立て続けに再取得しないための下限 */
const MIN_REFRESH_DELAY_MS = 1000

export class PhotoImageLoader {
  private snapshot: PhotoImageSnapshot
  private listeners = new Set<() => void>()
  private active = false
  /** 新しい取得を始めるたびに増える。古い取得の結果は捨てる */
  private token = 0
  private retried = false
  private timer: unknown = null
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(
    private readonly access: AccessApi,
    private readonly source: PhotoImageSource,
    deps: PhotoImageLoaderDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.snapshot = this.initialSnapshot()
  }

  private initialSnapshot(): PhotoImageSnapshot {
    const { local, path, userId } = this.source
    if (local) return { src: local, status: 'ready' }
    if (!path || !userId) return { src: null, status: 'failed' }
    const cached = this.access.peek(path)
    return cached ? { src: cached.url, status: 'ready' } : { src: null, status: 'loading' }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PhotoImageSnapshot => this.snapshot

  private set(next: PhotoImageSnapshot) {
    if (next.src === this.snapshot.src && next.status === this.snapshot.status) return
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }

  /** 画面に表示されたとき（useEffect）。クラウドの画像が必要なら取得を始める。何度呼んでも安全。 */
  start = () => {
    this.active = true
    const { local, path, userId } = this.source
    if (local || !path || !userId) return
    if (this.snapshot.status === 'ready' && this.snapshot.src) {
      this.scheduleRefresh(path)
      return
    }
    void this.load(false)
  }

  /** 画面から消えるとき。タイマーを止め、取得中の結果は捨てる */
  dispose = () => {
    this.active = false
    this.token++
    this.cancelTimer()
  }

  private cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private async load(forceRefresh: boolean) {
    const path = this.source.path
    if (!path) return
    const token = ++this.token
    const url = await this.access.getSignedUrl(path, { forceRefresh })
    if (!this.active || token !== this.token) return
    this.apply(url, path)
  }

  private apply(url: string | null, path: string) {
    this.cancelTimer()
    if (!url) {
      this.set({ src: null, status: 'failed' })
      return
    }
    this.set({ src: url, status: 'ready' })
    this.scheduleRefresh(path)
  }

  /** 失効の少し前に、URLを作り直す */
  private scheduleRefresh(path: string) {
    this.cancelTimer()
    const at = this.access.refreshAt(path)
    if (at === null) return
    const delay = Math.min(Math.max(at - this.now(), MIN_REFRESH_DELAY_MS), MAX_TIMER_MS)
    this.timer = this.setTimer(() => {
      this.timer = null
      if (!this.active) return
      this.retried = false
      void this.load(true)
    }, delay)
  }

  /**
   * <img> の読み込みに失敗したとき（署名付きURLの失効など）。クラウドの画像は、URLを1度だけ作り直す。
   * 作り直したURLでも失敗したら、failed にする（無限に再取得しない）。端末内の画像の失敗は作り直せない。
   */
  handleError = () => {
    const { local, path, userId } = this.source
    if (local || !path || !userId) {
      this.set({ src: null, status: 'failed' })
      return
    }
    if (this.retried) {
      this.cancelTimer()
      this.set({ src: null, status: 'failed' })
      return
    }
    this.retried = true
    void this.load(true)
  }
}
