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
  thumbnail_data_url: string    // base64 data URL（アップロード端末でのローカル即時表示用。他端末同期分は空文字）
  storage_path: string | null   // Supabase Storage上の600px圧縮写真パス（${user_id}/${id}.jpg）
  created_at: string
  updated_at: string
}
