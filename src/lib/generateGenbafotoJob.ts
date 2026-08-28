import type { Photo, Phase } from '@/types/photo'
import type { Project } from '@/types/project'

// Excel高互換出力（.genbafoto / C# Helper連携）用のジョブファイル生成ロジック。
//
// 責務はここまで：
//   対象Photo[] → 未同期確認 → STEP2 API呼び出し → photoIdとsigned URLの対応付け
//   → .genbafoto v1構築 → Blob生成 → ブラウザダウンロード
//
// UIコンポーネントの責務（ボタンの表示状態・トースト表示等）はここに含めない。
// 呼び出し側は戻り値の GenbafotoJobResult を見て、成功/失敗（理由別）を判断し、
// 必要な文言をUI側で表示する。

export type GenbafotoTemplateType = 'standard' | 'large' | 'beforeAfter'

const VALID_TEMPLATE_TYPES: readonly GenbafotoTemplateType[] = ['standard', 'large', 'beforeAfter']

// DESIGN.md 11-4（.genbafoto v1スキーマ）で確定した上限値
const MAX_PHOTOS = 300
const MAX_PROJECT_FIELD_LEN = 200
const MAX_COMMENT_LEN = 500
const MAX_FLOOR_LEN = 50
const MAX_LOCATION_LEN = 100

const API_ENDPOINT = '/api/create-genbafoto-job'

// ─── .genbafoto v1 型定義 ────────────────────────────────────────
//
// DESIGN.md 11-4 の確定仕様どおり、photoId・original_filename・sort_orderは
// 含めない。photos配列の順番そのものがExcel上の写真順を表す。

export interface GenbafotoPhotoV1 {
  no: number
  phase: Phase
  comment: string
  floor: string
  location: string
  takenAt: string | null
  imageUrl: string
  imageUrlExpiresAt: string
}

export interface GenbafotoJobV1 {
  schemaVersion: 1
  jobId: string
  createdAt: string
  templateType: GenbafotoTemplateType
  project: { name: string; location: string }
  photos: GenbafotoPhotoV1[]
}

export type GenbafotoJobFailureReason =
  | 'invalid_template_type'
  | 'no_photos'
  | 'too_many_photos'
  | 'unsynced'
  | 'auth_error'
  | 'network_error'
  | 'api_error'
  | 'response_mismatch'

export type GenbafotoJobResult =
  | { ok: true; jobId: string; filename: string; blob: Blob; job: GenbafotoJobV1 }
  | {
      ok: false
      reason: GenbafotoJobFailureReason
      message: string
      status?: number
      unsyncedCount?: number
    }

export interface GenerateGenbafotoJobDeps {
  /** 現在のSupabase Auth sessionからaccess_tokenを取得する。既定値は実際のsupabaseクライアントを使う。 */
  getAccessToken?: () => Promise<string | null>
  /** STEP2 API呼び出しに使うfetch実装。既定値はグローバルfetch。テストではmockに差し替える。 */
  fetchImpl?: typeof fetch
  /** createdAtに使う現在時刻。テストで固定するために注入可能にしている。 */
  now?: () => Date
  /** Blobダウンロードの実処理。既定値はgenerateExcel.tsのtriggerBlobDownload（DOM依存）。 */
  download?: (blob: Blob, filename: string) => void | Promise<void>
}

/**
 * 既定のダウンロード処理。ExcelJSチャンクを初期バンドルへ含めないよう、
 * ExportButton.tsx等の既存パターン（`await import('@/lib/generateExcel')`）と同様に
 * generateExcel.tsを動的インポートし、その中のtriggerBlobDownloadだけを再利用する
 * （Excel生成そのものは行わない。Blobダウンロードという汎用ユーティリティのみの再利用）。
 */
async function defaultDownload(blob: Blob, filename: string): Promise<void> {
  const { triggerBlobDownload } = await import('@/lib/generateExcel')
  triggerBlobDownload(blob, filename)
}

// ─── 写真の並び順・採番（既存ExcelJS出力と同じ結果になるようにする） ──────
//
// 既存の generateExcel / generateOneColumnExcel は「施工前→施工中→施工後」の順に
// 連結し、連結後の位置がそのままNo.になる（未分類はExcel出力対象外）。
// generateBeforeAfterExcel は施工前後それぞれをsort_order昇順に並べ、同じ
// インデックス同士をペアにする（duringは対象外）。ペアの施工前・施工後は
// 同じNo.を共有する（例：「施工前 No.3」「施工後 No.3」）。
// ここではその挙動をそのまま再現し、既存ExcelJS生成コード自体には一切触れない。

interface OrderedPhoto {
  photo: Photo
  no: number
}

export function orderPhotosForGenbafoto(
  photos: Photo[],
  templateType: GenbafotoTemplateType,
): OrderedPhoto[] {
  const sorted = [...photos].sort((a, b) => a.sort_order - b.sort_order)

  if (templateType === 'beforeAfter') {
    const befores = sorted.filter((p) => p.phase === 'before')
    const afters = sorted.filter((p) => p.phase === 'after')
    const len = Math.max(befores.length, afters.length)
    const result: OrderedPhoto[] = []
    for (let i = 0; i < len; i++) {
      const no = i + 1
      if (befores[i]) result.push({ photo: befores[i], no })
      if (afters[i]) result.push({ photo: afters[i], no })
    }
    return result
  }

  // standard / large：施工前→施工中→施工後の順に連結し、通し番号を振る
  const before = sorted.filter((p) => p.phase === 'before')
  const during = sorted.filter((p) => p.phase === 'during')
  const after = sorted.filter((p) => p.phase === 'after')
  return [...before, ...during, ...after].map((photo, i) => ({ photo, no: i + 1 }))
}

// ─── 未同期チェック ──────────────────────────────────────────────

function isStoragePathReady(storagePath: Photo['storage_path']): boolean {
  return typeof storagePath === 'string' && storagePath.trim().length > 0
}

// ─── API呼び出し・レスポンス検証 ─────────────────────────────────

interface ApiSuccessResponse {
  expiresAt: string
  photos: { id: string; imageUrl: string }[]
}

function parseApiSuccessResponse(body: unknown): ApiSuccessResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const obj = body as Record<string, unknown>
  if (typeof obj.expiresAt !== 'string') return null
  if (!Array.isArray(obj.photos)) return null
  const photos: { id: string; imageUrl: string }[] = []
  for (const item of obj.photos) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).imageUrl !== 'string'
    ) {
      return null
    }
    photos.push({
      id: (item as Record<string, unknown>).id as string,
      imageUrl: (item as Record<string, unknown>).imageUrl as string,
    })
  }
  return { expiresAt: obj.expiresAt, photos }
}

function apiErrorMessage(status: number): string {
  if (status === 401) return '認証が必要です。再度ログインしてからお試しください。'
  if (status === 403) return '写真の一部にアクセスできませんでした。ページを再読み込みしてからお試しください。'
  if (status === 409) {
    return 'Excel高互換出力の準備ができていない写真が含まれています。通信環境を確認して再度お試しください。'
  }
  return 'ダウンロードURLの取得に失敗しました。しばらくしてから再度お試しください。'
}

/**
 * 現在のSupabase Auth sessionからaccess_tokenを取得する既定実装。
 * `@/lib/supabase`（import.meta.env依存）をここで静的importせず動的importに
 * しているのは、本モジュール自体をVite環境外（単体テスト等）で読み込めるようにするため
 * （defaultDownloadと同じ考え方。テストではgetAccessTokenを注入するため実際には呼ばれない）。
 */
async function defaultGetAccessToken(): Promise<string | null> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return null
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

// ─── メイン ──────────────────────────────────────────────────

export async function generateGenbafotoJob(
  project: Project,
  photos: Photo[],
  templateType: GenbafotoTemplateType,
  deps: GenerateGenbafotoJobDeps = {},
): Promise<GenbafotoJobResult> {
  const {
    getAccessToken = defaultGetAccessToken,
    fetchImpl = fetch,
    now = () => new Date(),
    download = defaultDownload,
  } = deps

  if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
    return {
      ok: false,
      reason: 'invalid_template_type',
      message: 'テンプレート種別が不正です。',
    }
  }

  const ordered = orderPhotosForGenbafoto(photos, templateType)

  if (ordered.length === 0) {
    return { ok: false, reason: 'no_photos', message: '出力対象の写真がありません。' }
  }

  if (ordered.length > MAX_PHOTOS) {
    return {
      ok: false,
      reason: 'too_many_photos',
      message: `写真が${MAX_PHOTOS}枚を超えているため、Excel高互換出力できません。`,
    }
  }

  // 未同期チェック：storage_pathがnull/undefined/空文字の写真が1枚でもあれば、
  // APIを呼ばずに処理を中止する（黙って除外しない）。
  const unsyncedCount = ordered.filter((o) => !isStoragePathReady(o.photo.storage_path)).length
  if (unsyncedCount > 0) {
    return {
      ok: false,
      reason: 'unsynced',
      unsyncedCount,
      message: `Excel高互換出力の準備ができていない写真が${unsyncedCount}枚あります。通信環境を確認して再度お試しください。`,
    }
  }

  const accessToken = await getAccessToken()
  if (!accessToken) {
    return {
      ok: false,
      reason: 'auth_error',
      message: 'ログイン状態を確認できませんでした。再度ログインしてからお試しください。',
    }
  }

  const photoIds = ordered.map((o) => o.photo.id)

  let response: Response
  try {
    response = await fetchImpl(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ photoIds }),
    })
  } catch {
    // access_tokenやsigned URLが漏れないよう、エラー内容は詳細を出さずログに残す程度に留める
    console.error('[generateGenbafotoJob] API呼び出しに失敗しました（ネットワークエラー）')
    return {
      ok: false,
      reason: 'network_error',
      message: '通信に失敗しました。ネットワーク環境を確認して再度お試しください。',
    }
  }

  if (!response.ok) {
    console.error('[generateGenbafotoJob] API呼び出しがエラーを返しました:', response.status)
    return {
      ok: false,
      reason: 'api_error',
      status: response.status,
      message: apiErrorMessage(response.status),
    }
  }

  let rawBody: unknown
  try {
    rawBody = await response.json()
  } catch {
    return {
      ok: false,
      reason: 'api_error',
      status: response.status,
      message: 'サーバーからの応答を解析できませんでした。',
    }
  }

  const parsed = parseApiSuccessResponse(rawBody)
  if (!parsed) {
    return {
      ok: false,
      reason: 'api_error',
      status: response.status,
      message: 'サーバーからの応答が不正です。',
    }
  }

  // photoIdとsigned URLの対応付け：レスポンスの順番がrequest順と同じであることを
  // 前提にせず、必ずidで対応付ける。1件でも対応するURLが存在しなければ生成しない。
  const urlById = new Map(parsed.photos.map((p) => [p.id, p.imageUrl]))
  const missing = ordered.filter((o) => !urlById.has(o.photo.id))
  if (missing.length > 0) {
    console.error('[generateGenbafotoJob] APIレスポンスに対応するURLが不足しています:', missing.length)
    return {
      ok: false,
      reason: 'response_mismatch',
      message: '写真のダウンロードURL取得に失敗しました。しばらくしてから再度お試しください。',
    }
  }

  const jobId = crypto.randomUUID()
  const createdAt = now().toISOString()

  const job: GenbafotoJobV1 = {
    schemaVersion: 1,
    jobId,
    createdAt,
    templateType,
    project: {
      name: clamp(project.name, MAX_PROJECT_FIELD_LEN),
      location: clamp(project.location, MAX_PROJECT_FIELD_LEN),
    },
    photos: ordered.map(({ photo, no }) => ({
      no,
      // ordered は standard/large では phase in {before,during,after}、
      // beforeAfterでは phase in {before,after} の写真のみを含むため、
      // ここに到達する時点で phase は必ず非null。
      phase: photo.phase as Phase,
      comment: clamp(photo.comment, MAX_COMMENT_LEN),
      floor: clamp(photo.floor ?? '', MAX_FLOOR_LEN),
      location: clamp(photo.location ?? '', MAX_LOCATION_LEN),
      takenAt: photo.taken_at,
      imageUrl: urlById.get(photo.id)!,
      imageUrlExpiresAt: parsed.expiresAt,
    })),
  }

  const filename = `${jobId}.genbafoto`
  const blob = new Blob([JSON.stringify(job)], { type: 'application/json' })
  await download(blob, filename)

  return { ok: true, jobId, filename, blob, job }
}
