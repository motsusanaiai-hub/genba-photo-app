export interface Project {
  id: string
  user_id: string
  name: string
  location: string
  start_date: string | null   // 'YYYY-MM-DD' or null
  end_date: string | null     // 'YYYY-MM-DD' or null
  status: 'active' | 'completed' | 'archived'
  cover_photo_id: string | null
  created_at: string          // ISO datetime
  updated_at: string          // ISO datetime
  // soft delete用の削除日時（未削除は null）。クラウド同期（useCloudSync）が
  // 「削除済みprojectを復活させない」ために参照する内部フィールドで、他の
  // 箇所からは通常参照しない。既存のlocalStorageに保存された古いProjectデータには
  // このキー自体が存在しない場合があるため optional にしており、
  // undefined は null（＝未削除）と同じ意味として扱うこと。
  deleted_at?: string | null
}

// photo_count は Week 3 で photos テーブルから算出。現時点は常に 0
export type ProjectWithCount = Project & { photo_count: number }

export interface ProjectFormData {
  name: string
  location: string
  start_date: string  // 'YYYY-MM-DD' or ''
  end_date: string    // 'YYYY-MM-DD' or ''
}
