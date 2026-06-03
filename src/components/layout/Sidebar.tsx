import { NavLink, useNavigate } from 'react-router-dom'
import { Home, FileText, Camera, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const navItems = [
  { to: '/', icon: Home, label: 'ホーム', end: true },
  { to: '/settings/templates', icon: FileText, label: 'テンプレート', end: false },
]

export function Sidebar() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const user = useAuthStore((s) => s.user)

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth/login')
  }

  return (
    <aside className="hidden lg:flex flex-col w-56 border-r bg-background h-screen sticky top-0 shrink-0">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          <span className="font-bold">現場フォト</span>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator />

      <div className="p-3 space-y-1">
        <p className="px-3 py-1 text-xs text-muted-foreground truncate">
          {user?.display_name ?? user?.email}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          ログアウト
        </Button>
      </div>
    </aside>
  )
}
