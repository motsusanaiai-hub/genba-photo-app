export type Phase = 'before' | 'during' | 'after'

export const PHASE_CONFIG = {
  before: { label: '施工前', badgeClass: 'bg-blue-100 text-blue-700',  tabClass: 'text-blue-600' },
  during: { label: '施工中', badgeClass: 'bg-amber-100 text-amber-700', tabClass: 'text-amber-600' },
  after:  { label: '施工後', badgeClass: 'bg-green-100 text-green-700',  tabClass: 'text-green-600' },
} satisfies Record<Phase, { label: string; badgeClass: string; tabClass: string }>

/** 未分類を含むフェーズ選択肢（保存先トースト・長押しメニュー・半透明撮影画面で共通使用） */
export const PHASE_OPTIONS: { value: Phase | null; label: string }[] = [
  { value: null,     label: '未分類' },
  { value: 'before', label: PHASE_CONFIG.before.label },
  { value: 'during', label: PHASE_CONFIG.during.label },
  { value: 'after',  label: PHASE_CONFIG.after.label },
]

/** 未分類を含むフェーズキー（表示フィルタ・比較モードのタブ切替などで共通使用） */
export type PhaseKey = Phase | 'unclassified'

export const ALL_PHASE_KEYS: PhaseKey[] = ['before', 'during', 'after', 'unclassified']

export const PHASE_KEY_LABEL: Record<PhaseKey, string> = {
  before: PHASE_CONFIG.before.label,
  during: PHASE_CONFIG.during.label,
  after: PHASE_CONFIG.after.label,
  unclassified: '未分類',
}

export function phaseKeyOf(photo: Pick<Photo, 'phase'>): PhaseKey {
  return photo.phase ?? 'unclassified'
}

export function filterByPhaseKey(photos: Photo[], key: PhaseKey): Photo[] {
  return photos.filter((p) => phaseKeyOf(p) === key)
}

/** フェーズタブの選択中スタイル（フェーズ表示フィルタ・比較モードのタブなどで共通使用） */
export const PHASE_KEY_ACTIVE_CLASS: Record<PhaseKey, string> = {
  before: 'bg-blue-100 text-blue-700 border-blue-300',
  during: 'bg-amber-100 text-amber-700 border-amber-300',
  after: 'bg-green-100 text-green-700 border-green-300',
  unclassified: 'bg-gray-200 text-gray-700 border-gray-400',
}

export interface Photo {
  id: string
  project_id: string
  user_id: string
  original_filename: string
  file_size: number
  width: number | null
  height: number | null
  taken_at: string | null        // ISO datetime（EXIFまたは file.lastModified）
  comment: string
  floor?: string                 // 階数（例: "2階"）。旧データには存在しない場合がある
  location?: string              // 場所（例: "機械室"）。旧データには存在しない場合がある
  sort_order: number
  phase: Phase | null
  // 未分類フォルダのID。未分類（phase===null）の時のみ意味を持つ。
  // 施工前/中/後へ分類した時点でnullに戻す（フォルダは未分類写真の整理専用）。
  // 旧データには存在しない場合があるためoptional（undefinedはnullと同じ＝未分類直下扱い）。
  folder_id?: string | null
  // 分類直前まで所属していたフォルダのID。未分類→施工前/中/後で
  // folder_id をnullに戻す際に「現在のfolder_id」をここへ退避し、
  // 施工前/中/後→未分類で戻す際にここから復元する（フォルダが削除済みなら復元しない）。
  // 未分類の状態では常にnull（previous_folder_id!==null は「現在分類中」を意味する）。
  previous_folder_id?: string | null
  thumbnail_data_url: string    // base64 data URL（アップロード端末でのローカル即時表示用。他端末同期分は空文字）
  storage_path: string | null   // Supabase Storage上の600px圧縮写真パス（${user_id}/${id}.jpg）
  created_at: string
  updated_at: string
  format_warning?: boolean      // 取り込み時にサムネイル/圧縮生成に失敗した（クライアントのみ・DB非保存）
}

/** 未分類タブ内の写真整理用フォルダ（階層化対応。トップレベルは parent_folder_id === null） */
export interface PhotoFolder {
  id: string
  project_id: string
  user_id: string
  name: string
  // 親フォルダのID。null/undefinedはトップレベル（未分類フォルダ一覧直下）を意味する。
  // 旧データ（1階層時代に作成されたフォルダ）には存在しない場合があるためoptional。
  parent_folder_id?: string | null
  sort_order: number
  created_at: string
  updated_at: string
}
