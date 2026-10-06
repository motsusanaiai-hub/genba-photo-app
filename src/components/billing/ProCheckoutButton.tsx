import { useState } from 'react'
import { Crown, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** 配置先での余白調整などに使う任意クラス（RemoveAdsButtonと同じ慣習）。 */
  className?: string
}

/**
 * Proプラン（月額）の購入導線。
 *
 * VITE_PRO_CHECKOUT_ENABLED === 'true' のビルドでのみ表示する
 * （Webhook によるPro反映が未実装の間、Production等で購入導線を出さないため）。
 * plan === 'pro' のユーザーには表示しない。最終的な二重申し込みの拒否はサーバー側
 * （/api/create-pro-checkout-session）が行う。
 *
 * クリック時、user_id / price 等はクライアントから送らない。Supabaseの現在の
 * セッションから access token だけを取得して送る。
 */
export function ProCheckoutButton({ className }: Props) {
  const plan = useAuthStore((s) => s.user?.plan ?? 'free')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (import.meta.env.VITE_PRO_CHECKOUT_ENABLED !== 'true') return null
  if (plan === 'pro') return null

  const handleClick = async () => {
    if (status === 'loading') return
    setStatus('loading')
    setErrorMessage(null)

    try {
      if (!supabase) {
        throw new Error('この環境では購入機能を利用できません')
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) {
        throw new Error('ログイン状態を確認できませんでした。再度ログインしてからお試しください。')
      }

      const res = await fetch('/api/create-pro-checkout-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? '決済ページの準備に失敗しました。しばらくしてから再度お試しください。')
      }

      // 遷移完了まで loading のままにして、連打による再リクエストを防ぐ。
      window.location.href = data.url
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : '予期しないエラーが発生しました。')
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Button size="sm" onClick={handleClick} disabled={status === 'loading'} className="gap-1.5">
        {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
        Proプラン 月額300円
      </Button>
      {status === 'error' && errorMessage && (
        <p className="text-xs text-destructive text-center max-w-xs">{errorMessage}</p>
      )}
    </div>
  )
}
