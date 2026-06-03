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
}

// photo_count は Week 3 で photos テーブルから算出。現時点は常に 0
export type ProjectWithCount = Project & { photo_count: number }

export interface ProjectFormData {
  name: string
  location: string
  start_date: string  // 'YYYY-MM-DD' or ''
  end_date: string    // 'YYYY-MM-DD' or ''
}
