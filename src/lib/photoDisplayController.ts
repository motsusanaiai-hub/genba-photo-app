import type { Photo } from '@/types/photo'

/**
 * 1枚の写真を大きく表示する画面（ライトボックス・撮影オーバーレイ）の画像取得を、
 * 「いま表示している写真」の結果だけ反映するように管理する（React に依存しない）。
 *
 *   端末内の原本（IndexedDB）→ 端末内のサムネイル → クラウドの圧縮画像（署名付きURL）の順に使う。
 *   写真が切り替わった・画面が閉じられたら dispose し、それまでの取得結果（再取得中のものを含む）は
 *   完了が後になっても画面の状態へ反映せず、作った原本のURLも解放する。
 *   通信そのものは止めず、古い結果を表示しないことを保証する。
 */

export interface PhotoDisplayState {
  /** 表示するURL。取得中・取得できないときは null（前の写真のURLは持ち越さない） */
  url: string | null
  loading: boolean
  /** 端末内の原本（IndexedDB）から作ったURLか */
  localOriginal: boolean
}

export interface PhotoDisplayDeps {
  /** 端末内の原本のURL（無ければ null） */
  getLocalObjectUrl: (photoId: string) => Promise<string | null>
  /** 端末内の600px圧縮画像（IndexedDB）の Blob URL（無ければ null）。ここで作った URL は controller が解放する */
  getLocalCompressedUrl?: (photoId: string) => Promise<string | null>
  /** サムネイルまたはクラウドの署名付きURL（無ければ null） */
  loadDisplayUrl: (photo: Photo) => Promise<string | null>
  /** 署名付きURLの作り直し（端末内の画像は null） */
  refreshDisplayUrl: (photo: Photo) => Promise<string | null>
  revokeObjectUrl: (url: string) => void
  /** 表示してよい写真（本人の写真）か */
  canAccess: (photo: Photo) => boolean
}

type Stage = 'original' | 'thumbnail' | 'compressed' | 'cloud'
/** 取得の優先順位。表示に失敗したら、この順で次の段階へ進む */
const STAGES: readonly Stage[] = ['original', 'thumbnail', 'compressed', 'cloud']

export class PhotoDisplayController {
  private disposed = false
  /** クラウド画像の署名付きURL作り直し（1回だけ） */
  private retried = false
  /** いま表示しようとしている段階（null は未取得・表示なし） */
  private stage: Stage | null = null
  /** この controller が作った Blob URL（解放の責任を持つ。表示を離れるときに1度だけ解放する） */
  private ownedObjectUrl: string | null = null
  /** 取得・フォールバックのたびに増える。古い非同期処理の結果は、世代が違えば捨てる */
  private generation = 0

  constructor(
    private readonly photo: Photo,
    private readonly deps: PhotoDisplayDeps,
    private readonly onChange: (state: PhotoDisplayState) => void,
  ) {}

  private emit(url: string | null, loading: boolean) {
    this.onChange({ url, loading, localOriginal: this.stage !== null && this.stage !== 'cloud' })
  }

  private releaseOwned() {
    if (this.ownedObjectUrl) this.deps.revokeObjectUrl(this.ownedObjectUrl)
    this.ownedObjectUrl = null
  }

  /** 取得を始める。取得中は url=null（前の写真を出さない） */
  async load(): Promise<void> {
    const gen = ++this.generation
    this.emit(null, true)
    if (!this.deps.canAccess(this.photo)) {
      this.emit(null, false)
      return
    }
    await this.resolveFrom(0, gen)
  }

  /**
   * 指定した段階から順に、表示できる画像を探す。
   *   原本（IndexedDB）→ サムネイル → 端末内の圧縮画像（IndexedDB）→ クラウド（署名付きURL）
   * 各段階が無い・読めない場合は次へ。表示を決めたら、その段階を記録する。
   */
  private async resolveFrom(startIndex: number, gen: number): Promise<void> {
    const stale = () => this.disposed || gen !== this.generation
    for (let i = startIndex; i < STAGES.length; i++) {
      const stage = STAGES[i]
      if (stage === 'original') {
        const url = await this.deps.getLocalObjectUrl(this.photo.id)
        if (stale()) {
          if (url) this.deps.revokeObjectUrl(url)
          return
        }
        if (url) return this.show(stage, url, true)
      } else if (stage === 'thumbnail') {
        if (this.photo.thumbnail_data_url) return this.show(stage, this.photo.thumbnail_data_url, false)
      } else if (stage === 'compressed') {
        if (!this.deps.getLocalCompressedUrl) continue
        let url: string | null = null
        try {
          url = await this.deps.getLocalCompressedUrl(this.photo.id)
        } catch {
          url = null
        }
        if (stale()) {
          if (url) this.deps.revokeObjectUrl(url)
          return
        }
        if (url) return this.show(stage, url, true)
      } else {
        // クラウドは storage_path がある場合だけ（無ければ通信しない）
        if (!this.photo.storage_path) break
        const url = await this.deps.loadDisplayUrl({ ...this.photo, thumbnail_data_url: '' })
        if (stale()) return
        this.stage = 'cloud'
        return this.emit(url, false)
      }
    }
    if (stale()) return
    this.stage = null
    this.emit(null, false)
  }

  private show(stage: Stage, url: string, owned: boolean) {
    this.stage = stage
    if (owned) this.ownedObjectUrl = url
    this.emit(url, false)
  }

  /**
   * 画像の読み込みに失敗したとき（<img onError>）。
   *   端末内の画像（原本・サムネイル・圧縮画像）なら、Blob URL を解放して次の段階（最終的にクラウド）へ進む。
   *   クラウドの画像なら、署名付きURLを1度だけ作り直す。それでも失敗したら表示しない。
   */
  async handleError(): Promise<void> {
    if (this.disposed || this.stage === null) return
    const gen = ++this.generation
    if (this.stage !== 'cloud') {
      const next = STAGES.indexOf(this.stage) + 1
      this.stage = null
      this.emit(null, true)
      this.releaseOwned()
      await this.resolveFrom(next, gen)
      return
    }
    if (this.retried) {
      this.stage = null
      this.emit(null, false)
      return
    }
    this.retried = true
    const url = await this.deps.refreshDisplayUrl({ ...this.photo, thumbnail_data_url: '' })
    if (this.disposed || gen !== this.generation) return
    this.emit(url, false)
  }

  /** 写真の切り替え・画面を閉じるとき。以降、取得結果は反映せず、作った Blob URL を解放する */
  dispose(): void {
    this.disposed = true
    this.generation++
    this.releaseOwned()
  }
}
