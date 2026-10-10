import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { shouldShowAds } from '@/lib/plan'
import { HOUSE_ADS, type AdPlacement } from '@/lib/houseAds'
import { HouseAdCard } from '@/components/common/HouseAdCard'
import { cn } from '@/lib/utils'

interface Props {
  /** 広告の表示位置。広告内容（src/lib/houseAds.ts）の選択に使う。 */
  placement?: AdPlacement
  /** 配置先での余白調整などに使う任意クラス（広告サービス固有の実装は書かないこと） */
  className?: string
}

/**
 * 広告表示の唯一の分岐点。
 * free: 自社広告を表示する / ads_removed・pro: 何もrenderしない（DOMに残さない）。
 *
 * 現時点では外部の広告SDK（AdSense等）とは接続しておらず、src/lib/houseAds.ts の自社広告だけを出す。
 * 将来、外部広告に切り替える場合も AdFrame の中身（HouseAdCard）だけを差し替え、
 * 読み込み失敗時は自社広告に戻す。呼び出し側の画面には広告サービス固有のコードを書かない。
 * plan は authStore から読むため、プラン自動更新（planRefresh）で plan が変われば表示も切り替わる。
 */
export function AdSlot({ placement = 'dashboard', className }: Props) {
  const plan = useAuthStore((s) => s.user?.plan ?? 'free')

  if (!shouldShowAds(plan)) return null

  return (
    <AdFrame className={className}>
      <HouseAdCard ad={HOUSE_ADS[placement]} />
    </AdFrame>
  )
}

/** 広告の共通の枠（幅・配置）。工事案件一覧より目立たないよう最大幅を抑えて中央に置く。 */
function AdFrame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-2xl', className)}>{children}</div>
}
