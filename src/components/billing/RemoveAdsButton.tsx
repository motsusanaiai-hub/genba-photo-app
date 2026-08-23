import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { shouldShowAds } from '@/lib/plan'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** 配置先での余白調整などに使う任意クラス（AdSlotと同じ慣習）。 */
  className?: string
}

/**
 * 広告削除（買い切り300円）の購入導線。
 *
 * 表示可否は shouldShowAds（AdSlotと同じ判定関数）を再利用する。
 * ads_removed / pro では「そもそも広告が出ていない」ため、このボタンも
 * 一切renderしない（ads_removed/proでの表示は行わない仕様。呼び出し側で
 * 余白用のdivを別に用意すると非表示時に空白だけ残ってしまうため、
 * 余白クラスもこのコンポーネント自身の外側要素に付与する設計にしている）。
 *
 * クリック時、user_idはクライアントから送らない。Supabaseの現在のセッションから
 * access tokenだけを取得し、サーバー側（/api/create-checkout-session）で
 * トークンを検証して初めて誰の購入かが決まる。
 */
export function RemoveAdsButton({ className }: Props) {
  const plan = useAuthStore((s) => s.user?.plan ?? 'free')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!shouldShowAds(plan)) return null

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

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? '決済ページの準備に失敗しました。しばらくしてから再度お試しください。')
      }

      window.location.href = data.url
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : '予期しないエラーが発生しました。')
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={status === 'loading'}
        className="gap-1.5"
      >
        {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
        広告を削除 300円
      </Button>
      {status === 'error' && errorMessage && (
        <p className="text-xs text-destructive text-center max-w-xs">{errorMessage}</p>
      )}
    </div>
  )
}
