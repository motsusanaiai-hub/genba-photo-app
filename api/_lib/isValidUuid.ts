// Stripe Webhookのmetadataに載ってきた文字列が、UUID形式として妥当かどうかだけを確認する。
// 「存在するprofilesのidかどうか」まではここでは見ない（それはRPC側の責務）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
