/**
 * 自社広告（ハウス広告）の内容。
 *
 * 広告の文言・リンク先はここにだけ書き、表示側（AdSlot / HouseAdCard）には書かない。
 * 将来 AdSense 等の外部広告へ切り替える場合も、AdSlot の中で表示部分だけを差し替え、
 * ここの自社広告は外部広告が使えないとき（読み込み失敗・未配信など）の代替として残せる。
 */

/** 広告の表示位置。現在はダッシュボードの1か所だけ。 */
export type AdPlacement = 'dashboard'

export interface HouseAd {
  /** 広告主（「広告」ラベルと並べて表示する） */
  advertiser: string
  /** サービス名 */
  service: string
  /** キャッチコピー */
  headline: string
  /** 説明文 */
  description: string
  /** ボタンの文言 */
  cta: string
  /** リンク先（新しいタブで開く） */
  url: string
}

export const HOUSE_ADS: Record<AdPlacement, HouseAd> = {
  dashboard: {
    advertiser: '株式会社ACE',
    service: 'ACE-DX',
    headline: '建設現場の「面倒」を、AIでもっと簡単に。',
    description: '写真管理・工程調整・社内資料検索など、建設業の業務改善をAIでサポート。',
    cta: 'ACE-DXのサービスを見る →',
    url: 'https://ace-dx.jp/',
  },
}
