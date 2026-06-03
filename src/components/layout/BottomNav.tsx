import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Home, PlusCircle, FileText, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'

export function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const user = useAuthStore((s) => s.user)

  const handleAdd = () => {
    // Week 3以降: プロジェクト詳細ではアップロードモーダルを開く
    // 現時点: ダッシュボードでは新規プロジェクト作成へ
    if (location.pathname === '/') {
      navigate('/projects/new')
    }
  }

  const handleAccount = async () => {
    const confirmed = window.confirm(`ログアウトしますか？\n${user?.email ?? ''}`)
    if (confirmed) {
      await signOut()
      navigate('/auth/login')
    }
  }

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background safe-bottom">
      <div className="flex">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center justify-center flex-1 py-2 text-xs gap-1 min-h-[56px] transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )
          }
        >
          <Home className="h-5 w-5" />
          ホーム
        </NavLink>

        <button
          onClick={handleAdd}
          className="flex flex-col items-center justify-center flex-1 py-2 text-xs gap-1 min-h-[56px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <PlusCircle className="h-5 w-5" />
          追加
        </button>

        <NavLink
          to="/settings/templates"
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center justify-center flex-1 py-2 text-xs gap-1 min-h-[56px] transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )
          }
        >
          <FileText className="h-5 w-5" />
          テンプレ
        </NavLink>

        <button
          onClick={handleAccount}
          className="flex flex-col items-center justify-center flex-1 py-2 text-xs gap-1 min-h-[56px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <User className="h-5 w-5" />
          アカウント
        </button>
      </div>
    </nav>
  )
}
