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
  // YYYY-MM-DD → ローカルタイム補正のため T00:00:00 を付与
  const date = new Date(`${dateString}T00:00:00`)
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}
