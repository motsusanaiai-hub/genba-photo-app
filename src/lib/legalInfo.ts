/**
 * 利用規約（/terms）・プライバシーポリシー（/privacy）で使う運営者情報。会社情報はここだけで管理する
 * （規約とポリシーで同じ値が表示される。ページ側に直接書かない）。
 *
 * 確定している情報（運営者が確認済み）：
 *   運営会社・代表者・所在地・AI事業サイト・問い合わせフォーム（退会の受付窓口もこのフォーム）
 *   - 問い合わせフォームのURLは、AI事業サイトのトップページに記載されている「お問い合わせ」のリンク先で、
 *     直接URLで開けること・入力フォームがあることを読み取りだけで確認した（フォームへの入力・送信はしていない）。
 *   - 実在しないメールアドレスやフォームURLは作らない。トップページのURLをフォームの代わりにしない。
 * 確定していない情報は LEGAL_PENDING_ITEMS に一覧化し、本文では LegalPending で明示する。
 * 公開前に `npm run check:legal` で、未確定の項目が残っていないかを確認する。
 */
export const LEGAL = {
  serviceName: '現場フォト',
  operatorName: '株式会社ACE',
  /** 代表者 */
  representative: '代表取締役 茂木 克也',
  /** 所在地 */
  postalCode: '〒356-0004',
  address: '埼玉県ふじみ野市上福岡3-7-16',
  /** 運営者のAI事業サイト（ACE-DX。自社広告のリンク先と同じ） */
  operatorSiteUrl: 'https://ace-dx.jp/',
  operatorSiteName: 'ACE-DX',
  /** 問い合わせフォーム（ACE-DX のお問い合わせページ）。問い合わせ・退会の受付窓口 */
  contactFormUrl: 'https://ace-dx.jp/contact/',
  contactFormLabel: 'お問い合わせフォーム',
} as const

/**
 * 公開時または法的確認の後に確定する項目（本文中の LegalPending の item と対応する）。
 * 会社情報・問い合わせ先・退会の受付窓口は確定したため、ここには含めない。
 */
export const LEGAL_PENDING_ITEMS = {
  /** 公開時に確定する日付（勝手に決めない） */
  termsEnactedAt: '利用規約の制定日・施行日',
  privacyEnactedAt: 'プライバシーポリシーの制定日',
  /** 法的確認が必要な項目 */
  jurisdiction: '準拠法・裁判管轄',
  liability: '免責事項・責任の範囲の最終文言',
  disclosure: '個人情報の開示等の手続き',
} as const

export type LegalPendingKey = keyof typeof LEGAL_PENDING_ITEMS

/** 未確定の表示に使う目印（テストと公開前チェックで検索できるよう固定の文字列にしている） */
export const LEGAL_PENDING_MARK = '【未確定'

/** 裁判管轄の検討中の案。法的確認が済むまでは確定事項として表示しない（LegalPending の中でだけ示す）。 */
export const JURISDICTION_PROPOSAL = 'さいたま地方裁判所を第一審の合意管轄裁判所とする'
