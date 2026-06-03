import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { ProjectCard } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/Header'

export function DashboardPage() {
  const navigate = useNavigate()
  const { projects, removeProject } = useProjects()

  const handleDelete = (projectId: string, projectName: string) => {
    const confirmed = window.confirm(
      `「${projectName}」を削除しますか？\n\nこの操作は取り消せません。`,
    )
    if (confirmed) removeProject(projectId)
  }

  return (
    <>
      <Header
        title="現場フォト"
        right={
          <Button size="sm" className="hidden lg:flex" onClick={() => navigate('/projects/new')}>
            <Plus className="h-4 w-4" />
            新規作成
          </Button>
        }
      />

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
        onClick={() => navigate('/projects/new')}
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
