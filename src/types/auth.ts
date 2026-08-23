// Supabase profiles.plan の CHECK 制約 (free / ads_removed / pro) と対応。
// plan の書き換えは service_role 経由の信頼できるサーバー側処理のみが行う想定で、
// クライアントからの直接UPDATEはDB側の権限設定で禁止されている。
export type Plan = 'free' | 'ads_removed' | 'pro'

export interface AppUser {
  id: string
  email: string
  display_name: string
  plan: Plan
}
