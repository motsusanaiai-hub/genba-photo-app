import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useAuth } from '@/hooks/useAuth'

export default function App() {
  const { initialize, authMode } = useAuth()

  useEffect(() => {
    initialize()
  }, [initialize])

  // 本番ビルドで Supabase の設定が不足している場合は、モック認証に切り替えず設定エラーだけを表示する。
  // 端末内の工事案件・写真には触れない（読み込み・削除とも行わない）。
  if (authMode === 'misconfigured') return <ConfigErrorScreen />

  return <RouterProvider router={router} />
}

function ConfigErrorScreen() {
  return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-base font-semibold">現在ご利用いただけません</h1>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        認証サービスの設定が完了していないため、ログインできません。時間をおいて再度お試しください。
      </p>
    </div>
  )
}
