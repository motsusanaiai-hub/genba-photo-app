import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/**
 * Stripe Checkout（Pro・月額）の success_url 遷移先（最小版）。
 *
 * 広告削除用の /billing/success（CheckoutSuccessPage）は「plan が free 以外になったら完了」
 * と判定するため、ads_removed のユーザーがPro購入すると反映前でも完了扱いになる。
 * そのためPro用は別ページにしている。
 *
 * Pro反映（Webhook）は未実装のため、この画面では plan を確認せず「完了」とも表示しない。
 * plan === 'pro' になるまで待つ版は Webhook 実装後に作る。
 */
export function ProCheckoutSuccessPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4 text-center p-6">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">お手続きを受け付けました</h1>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          Proプランの反映まで時間がかかる場合があります。しばらくしてからアプリを再読み込みしてご確認ください。
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">ホームへ戻る</Link>
      </Button>
    </div>
  )
}
