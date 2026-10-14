/**
 * 新規購入（Stripe Checkout Session の作成）の受付可否。
 *
 * 現場フォトは完全無料化したため、広告削除（買い切り）・Pro（月額）の新規購入は受け付けない。
 * 環境変数に依存せず、コード上の定数で恒久的に止める（環境変数の設定漏れ・誤設定で
 * 購入が再開されてしまわないようにするため）。
 * 将来、課金を再開する場合は、この定数を true にするだけで元のCheckout処理が動く
 * （Checkout API 側のコードは削除していない）。
 *
 * 既存の Webhook・契約管理（Customer Portal）・購入履歴の処理はこの定数の対象外で、止めない。
 */
export const NEW_PURCHASES_OPEN: boolean = false

/** 新規購入の受付終了を示すHTTPステータス（410 Gone：この購入受付はもう提供されていない）。 */
export const PURCHASES_CLOSED_STATUS = 410

/** 受付終了時の応答本文。code は呼び出し側が機械的に判別するための固定値。 */
export const PURCHASES_CLOSED_BODY = {
  error: '新規購入の受付は終了しました。現場フォトはすべての機能を無料でご利用いただけます。',
  code: 'purchases_closed',
} as const
