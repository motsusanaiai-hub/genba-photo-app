import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { shouldShowAds } from '@/lib/plan'
import { Button } from '@/components/ui/button'
import type { Plan } from '@/types/auth'

const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 5

type ReflectState = 'checking' | 'done' | 'timeout'

/**
 * Stripe Checkout（広告削除・買い切り）の success_url 遷移先。
 *
 * Webhookの到着とこの画面の表示は非同期のため、画面表示直後にはまだ
 * plan が反映されていない可能性がある。そのため：
 *   1. まず1回 profiles を再取得する
 *   2. まだ free のままなら「確認中」を表示しつつ、2秒間隔・最大5回だけ再確認する
 *   3. 反映されたら即座に完了表示へ切り替える（authStoreのuserも更新し、
 *      AdSlot/RemoveAdsButtonが再読み込みなしで正しい状態になるようにする）
 *   4. 反映されないまま上限に達したら、エラー扱いにはせず
 *      「時間をおいて確認してください」という案内で終了する（無限ポーリングはしない）
 */
export function CheckoutSuccessPage() {
  const [state, setState] = useState<ReflectState>('checking')

  useEffect(() => {
    let cancelled = false

    const checkOnce = async (): Promise<boolean> => {
      const currentUser = useAuthStore.getState().user
      if (!supabase || !currentUser) return false

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', currentUser.id)
        .single()

      if (error || !profile) return false

      const plan = profile.plan as Plan
      if (!shouldShowAds(plan)) {
        // free以外（ads_removed/pro）になっていれば購入が反映されている
        useAuthStore.getState().setUser({ ...currentUser, plan })
        return true
      }
      return false
    }

    ;(async () => {
      for (let attempt = 0; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        if (cancelled) return
        const reflected = await checkOnce()
        if (cancelled) return
        if (reflected) {
          setState('done')
          return
        }
        if (attempt < MAX_POLL_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
      }
      if (!cancelled) setState('timeout')
    })()

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
            <h1 className="text-base font-semibold">購入処理を確認しています…</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              決済の反映まで少しお時間がかかる場合があります。
            </p>
          </div>
        </>
      )}

      {state === 'done' && (
        <>
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">広告削除が完了しました</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              ご購入ありがとうございます。以降、広告は表示されません。
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
              決済自体は完了している可能性があります。数分後にアプリを再読み込みしてご確認ください。
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
