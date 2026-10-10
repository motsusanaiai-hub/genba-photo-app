import { useEffect, useState } from 'react'
import { Crown, Loader2, Settings } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import {
  formatPeriodEnd,
  pickManageableSubscription,
  subscriptionGrantsPro,
  type SubscriptionRow,
} from '@/lib/subscription'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** 配置先での余白調整などに使う任意クラス（RemoveAdsButtonと同じ慣習）。 */
  className?: string
}

/**
 * Proプラン（月額）の契約内容表示と、Stripe Customer Portal への導線。
 *
 * 表示条件は plan ではなく、本人の subscriptions に終了していない行があること
 * （plan='pro' は pro_override の開発者アカウントでも立つため）。
 * subscriptions は RLS（subscriptions_select_own）で本人の行だけを参照できる。
 * ここでの判定は表示用で、Portal を開けるかの最終判定はサーバー側
 * （/api/create-billing-portal-session）が billing_customers / subscriptions を見て行う。
 *
 * 広告削除（買い切り）は Subscription を作らないため、このカードは表示されない。
 */
export function ManageSubscriptionCard({ className }: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  // plan が変わったとき（決済後の反映・タブ再表示での再取得）にも契約内容を取り直す。
  const plan = useAuthStore((s) => s.user?.plan ?? null)
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !userId) {
      setSubscription(null)
      return
    }

    let cancelled = false
    void supabase
      .from('subscriptions')
      .select('status, cancel_at_period_end, current_period_end')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // 取得できない場合はカード自体を出さない（契約の有無を推測で表示しない）。
          console.error('[ManageSubscriptionCard] subscriptions fetch failed', { code: error.code })
          setSubscription(null)
          return
        }
        setSubscription(pickManageableSubscription((data ?? []) as SubscriptionRow[]))
      })

    return () => {
      cancelled = true
    }
  }, [userId, plan])

  if (!subscription) return null

  const grantsPro = subscriptionGrantsPro(subscription.status)
  const periodEnd = formatPeriodEnd(subscription.current_period_end)

  const handleClick = async () => {
    if (status === 'loading') return
    setStatus('loading')
    setErrorMessage(null)

    try {
      if (!supabase) {
        throw new Error('この環境では契約管理を利用できません')
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) {
        throw new Error('ログイン状態を確認できませんでした。再度ログインしてからお試しください。')
      }

      const res = await fetch('/api/create-billing-portal-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? '契約管理ページの準備に失敗しました。しばらくしてから再度お試しください。')
      }

      // 遷移完了まで loading のままにして、連打による再リクエストを防ぐ。
      window.location.href = data.url
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : '予期しないエラーが発生しました。')
    }
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-3 max-w-md mx-auto', className)}>
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Crown className="h-4 w-4 text-amber-500" />
          {grantsPro ? 'Proプランをご利用中' : 'Proプランのご契約'}
        </p>
        <p className="text-xs text-muted-foreground">月額300円（税込）</p>
      </div>

      {subscription.status === 'past_due' && (
        <p className="text-xs text-destructive leading-relaxed">
          お支払いを確認できていません。お支払い方法をご確認ください。
        </p>
      )}
      {!grantsPro && (
        <p className="text-xs text-destructive leading-relaxed">
          現在Proプランをご利用いただけない状態です。お支払い状況をご確認ください。
        </p>
      )}
      {grantsPro && subscription.cancel_at_period_end && (
        <p className="text-xs text-amber-700 leading-relaxed">
          {periodEnd ? `${periodEnd}に解約予定です。` : '解約予定です。'}
          それまではProプランをご利用いただけます。
        </p>
      )}
      {grantsPro && !subscription.cancel_at_period_end && periodEnd && (
        <p className="text-xs text-muted-foreground">次回更新日：{periodEnd}</p>
      )}

      <Button
        variant="outline"
        onClick={handleClick}
        disabled={status === 'loading'}
        className="w-full gap-1.5"
      >
        {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
        契約内容・お支払いの管理
      </Button>
      {status === 'error' && errorMessage && (
        <p className="text-xs text-destructive text-center">{errorMessage}</p>
      )}
    </div>
  )
}
