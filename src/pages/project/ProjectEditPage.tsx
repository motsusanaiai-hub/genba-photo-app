import { useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { Header } from '@/components/layout/Header'
import { ProjectForm } from '@/components/project/ProjectForm'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { ProjectFormData } from '@/types/project'

export function ProjectEditPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject, editProject, removeProject } = useProjects()
  const [isLoading, setIsLoading] = useState(false)

  const project = getProject(projectId ?? '')
  if (!project) return <Navigate to="/" replace />

  const handleSubmit = async (data: ProjectFormData) => {
    setIsLoading(true)
    editProject(project.id, data)
    navigate(`/projects/${project.id}`, { replace: true })
  }

  const handleDelete = () => {
    const confirmed = window.confirm(
      `「${project.name}」を削除しますか？\n\nこの操作は取り消せません。`,
    )
    if (confirmed) {
      removeProject(project.id)
      navigate('/', { replace: true })
    }
  }

  return (
    <>
      <Header
        title="工事を編集"
        left={
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="p-4 lg:p-6 max-w-lg mx-auto space-y-8">
        <ProjectForm
          defaultValues={{
            name: project.name,
            location: project.location,
            start_date: project.start_date ?? '',
            end_date: project.end_date ?? '',
          }}
          onSubmit={handleSubmit}
          submitLabel="保存する"
          isLoading={isLoading}
        />

        <div>
          <Separator className="mb-6" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">危険な操作</p>
            <p className="text-xs text-muted-foreground">
              プロジェクトを削除すると、すべての写真とコメントも削除されます。この操作は取り消せません。
            </p>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground w-full sm:w-auto"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              このプロジェクトを削除
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
