import { useAuthStore } from '@/store/authStore'
import { shouldShowAds } from '@/lib/plan'
import { cn } from '@/lib/utils'

interface Props {
  /** 配置先での余白調整などに使う任意クラス（広告サービス固有の実装は書かないこと） */
  className?: string
}

/**
 * 広告表示の唯一の分岐点。
 * free: ダミーの広告枠を表示する / ads_removed・pro: 何もrenderしない（DOMに残さない）。
 *
 * 現時点では実際の広告SDK（AdSense/AdMob等）とは接続していないダミー表示。
 * 将来、実SDKに差し替える際もこのコンポーネント内部だけを変更すればよく、
 * 呼び出し側の画面には広告サービス固有のコードを一切書かない設計とする。
 */
export function AdSlot({ className }: Props) {
  const plan = useAuthStore((s) => s.user?.plan ?? 'free')

  if (!shouldShowAds(plan)) return null

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground text-xs py-6',
        className,
      )}
      aria-label="広告"
    >
      広告スペース
    </div>
  )
}
