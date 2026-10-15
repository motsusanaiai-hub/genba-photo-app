/**
 * 利用規約・プライバシーポリシー（/terms・/privacy）で使う運営者情報。
 *
 * 確実に確認できるものだけを定数にしている：
 *   - 運営者（株式会社ACE）とWebサイト … 自社広告（src/lib/houseAds.ts）の広告主・リンク先と同じ
 *   - サービス名 … index.html / manifest の名称
 * 次の項目は確定していないため、本文では「未確定」の表示（LegalPending）にしてある。
 * 公開前に運営者が決めて、本文の該当箇所を差し替えること（実在しないメールアドレスやフォームURLは作らない）。
 */
export const LEGAL = {
  serviceName: '現場フォト',
  operatorName: '株式会社ACE',
  /** 運営者のWebサイト（自社広告のリンク先と同じ。問い合わせ窓口として使えるかは未確認） */
  operatorSiteUrl: 'https://ace-dx.jp/',
} as const

/** 公開前に確定・差し替えが必要な項目（本文中の LegalPending の label と対応する） */
export const LEGAL_PENDING_ITEMS = {
  contact: '問い合わせ先',
  enactedAt: '制定日・施行日',
  operatorAddress: '運営者の所在地・代表者名',
  governingLaw: '準拠法・裁判管轄',
  withdrawal: '退会（アカウント削除）の受付方法',
  liability: '責任の範囲に関する最終文言',
} as const

export type LegalPendingKey = keyof typeof LEGAL_PENDING_ITEMS

/** 未確定の表示に使う目印（テストと公開前チェックで検索できるよう固定の文字列にしている） */
export const LEGAL_PENDING_MARK = '【未確定'
