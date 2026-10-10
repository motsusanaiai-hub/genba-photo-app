import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { pollPlanUntil } from '@/lib/planRefresh'
import { Button } from '@/components/ui/button'

/** Webhook 反映待ちの再確認間隔と回数（最大 約28秒。無制限には待たない）。 */
export const PRO_REFLECT_POLL_INTERVAL_MS = 2_000
export const PRO_REFLECT_MAX_ATTEMPTS = 15

type ReflectState = 'checking' | 'done' | 'timeout'

/**
 * Stripe Checkout（Pro・月額）の success_url 遷移先。
 *
 * Webhook（Pro同期）の反映とこの画面の表示は非同期のため、profiles.plan を一定回数だけ再取得し、
 * 'pro' になったら完了表示に切り替える（authStore の plan も更新されるため、広告・上限は再読み込みなしで外れる）。
 * 広告削除用の /billing/success（plan が free 以外になったら完了）とは判定が異なる：
 * ads_removed のユーザーが Pro を購入した場合、反映前でも free 以外のため、ここでは 'pro' になるまで待つ。
 * 反映されないまま上限に達した場合はエラー扱いにせず、時間をおいて確認するよう案内する。
 */
export function ProCheckoutSuccessPage() {
  const [state, setState] = useState<ReflectState>('checking')

  useEffect(() => {
    let cancelled = false
    void pollPlanUntil({
      isReflected: (plan) => plan === 'pro',
      maxAttempts: PRO_REFLECT_MAX_ATTEMPTS,
      intervalMs: PRO_REFLECT_POLL_INTERVAL_MS,
      isCancelled: () => cancelled,
    }).then((result) => {
      if (result.status === 'reflected') setState('done')
      else if (result.status === 'timeout') setState('timeout')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4 text-center p-6">
      {state === 'checking' && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">お申し込みを確認しています…</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              Proプランの反映まで少しお時間がかかる場合があります。
            </p>
          </div>
        </>
      )}

      {state === 'done' && (
        <>
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">Proプランが有効になりました</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              ご契約ありがとうございます。広告は表示されず、工事案件を無制限に登録できます。
            </p>
          </div>
          <Button asChild>
            <Link to="/">ホームへ戻る</Link>
          </Button>
        </>
      )}

      {state === 'timeout' && (
        <>
          <div className="space-y-1">
            <h1 className="text-base font-semibold">反映の確認に時間がかかっています</h1>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              お手続き自体は完了している可能性があります。数分後にアプリを開き直してご確認ください。
              それでも反映されない場合はサポートまでお問い合わせください。
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">ホームへ戻る</Link>
          </Button>
        </>
      )}
    </div>
  )
}
