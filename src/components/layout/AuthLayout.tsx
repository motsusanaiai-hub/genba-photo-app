import { Outlet } from 'react-router-dom'
import { Camera } from 'lucide-react'

export function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Camera className="h-7 w-7" />
            <h1 className="text-2xl font-bold tracking-tight">現場フォト</h1>
          </div>
          <p className="text-muted-foreground text-sm">工事写真台帳を楽に作る</p>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
