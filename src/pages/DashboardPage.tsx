import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, X } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { ProjectCard } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/Header'
import { PROJECT_LIMIT_MESSAGE } from '@/lib/plan'

export function DashboardPage() {
  const navigate = useNavigate()
  const { projects, canCreateNewProject, removeProject } = useProjects()
  const [showLimitNotice, setShowLimitNotice] = useState(false)

  const handleDelete = async (projectId: string, projectName: string) => {
    const confirmed = window.confirm(
      `「${projectName}」を削除しますか？\n\nこの操作は取り消せません。`,
    )
    if (confirmed) await removeProject(projectId)
  }

  // 新規作成の入口（ヘッダーボタン・FAB共通）。上限到達時は遷移させず理由を表示する。
  const handleNewProjectClick = () => {
    if (!canCreateNewProject) {
      setShowLimitNotice(true)
      return
    }
    navigate('/projects/new')
  }

  return (
    <>
      <Header
        title="現場フォト"
        right={
          <Button size="sm" className="hidden lg:flex" onClick={handleNewProjectClick}>
            <Plus className="h-4 w-4" />
            新規作成
          </Button>
        }
      />

      {showLimitNotice && (
        <div className="mx-4 mt-4 lg:mx-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm p-3 leading-relaxed">
          <span className="flex-1">{PROJECT_LIMIT_MESSAGE}</span>
          <button
            onClick={() => setShowLimitNotice(false)}
            className="shrink-0 text-amber-700 hover:text-amber-900"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="p-4 lg:p-6">
        {projects.length === 0 ? (
          <EmptyState onAction={() => navigate('/projects/new')} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/projects/${project.id}`)}
                onEdit={() => navigate(`/projects/${project.id}/edit`)}
                onDelete={() => handleDelete(project.id, project.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* スマホ用 FAB */}
      <button
        onClick={handleNewProjectClick}
        className="lg:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="工事を登録する"
      >
        <Plus className="h-6 w-6" />
      </button>
    </>
  )
}

function EmptyState({ onAction }: { onAction: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
      <div className="rounded-full bg-muted p-6">
        <FolderOpen className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">工事がまだ登録されていません</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          最初の工事プロジェクトを登録して、写真と台帳を管理しましょう
        </p>
      </div>
      <Button onClick={onAction}>
        <Plus className="h-4 w-4" />
        工事を登録する
      </Button>
    </div>
  )
}
