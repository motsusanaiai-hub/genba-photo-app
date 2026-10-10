import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { useCloudSync } from '@/hooks/useCloudSync'
import { usePlanRefreshOnVisible } from '@/hooks/usePlanRefreshOnVisible'

export function AppLayout() {
  useCloudSync()
  usePlanRefreshOnVisible()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* pb-14: スマホのボトムナビ分のパディング */}
        <main className="flex-1 overflow-y-auto pb-14 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
