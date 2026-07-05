export function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今日'
  if (diffDays === 1) return '昨日'
  if (diffDays < 7) return `${diffDays}日前`
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  // 日付のみ（YYYY-MM-DD）は UTC 扱いになるのを防ぐため T00:00:00 を付与してローカル日時として解釈させる。
  // タイムスタンプ付き（例: taken_at の ISO 文字列）はそのまま Date に渡し、ローカルタイムゾーンで日付を算出する。
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? new Date(`${dateString}T00:00:00`) : new Date(dateString)
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}
