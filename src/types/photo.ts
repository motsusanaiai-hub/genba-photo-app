export type Phase = 'before' | 'during' | 'after'

export const PHASE_CONFIG = {
  before: { label: '施工前', badgeClass: 'bg-blue-100 text-blue-700',  tabClass: 'text-blue-600' },
  during: { label: '施工中', badgeClass: 'bg-amber-100 text-amber-700', tabClass: 'text-amber-600' },
  after:  { label: '施工後', badgeClass: 'bg-green-100 text-green-700',  tabClass: 'text-green-600' },
} satisfies Record<Phase, { label: string; badgeClass: string; tabClass: string }>

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
  sort_order: number
  phase: Phase | null
  thumbnail_data_url: string    // base64 data URL（モック専用。Supabase移行時は storage_path に変更）
  created_at: string
  updated_at: string
}
