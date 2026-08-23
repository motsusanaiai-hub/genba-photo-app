import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { Header } from '@/components/layout/Header'
import { ProjectForm } from '@/components/project/ProjectForm'
import { Button } from '@/components/ui/button'
import { PROJECT_LIMIT_MESSAGE } from '@/lib/plan'
import type { ProjectFormData } from '@/types/project'

export function ProjectNewPage() {
  const navigate = useNavigate()
  const { canCreateNewProject, createProject } = useProjects()
  const [isLoading, setIsLoading] = useState(false)
  // createProject が上限到達で null を返した場合の案内表示用
  // （URL直打ち等で下のcanCreateNewProjectガードをすり抜けて送信された場合の保険）
  const [limitError, setLimitError] = useState(false)

  const handleSubmit = async (data: ProjectFormData) => {
    setIsLoading(true)
    const project = await createProject(data)
    if (!project) {
      // 上限到達で作成拒否：遷移させず、理由を表示する
      setIsLoading(false)
      setLimitError(true)
      return
    }
    navigate(`/projects/${project.id}`, { replace: true })
  }

  return (
    <>
      <Header
        title="新しい工事を登録"
        left={
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="p-4 lg:p-6 max-w-lg mx-auto">
        {/* URL直打ち等で上限到達後に直接アクセスされた場合、フォーム自体を表示しない */}
        {!canCreateNewProject ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm p-4 leading-relaxed">
            {PROJECT_LIMIT_MESSAGE}
          </div>
        ) : (
          <>
            {limitError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm p-4 leading-relaxed mb-4">
                {PROJECT_LIMIT_MESSAGE}
              </div>
            )}
            <ProjectForm
              onSubmit={handleSubmit}
              submitLabel="登録する"
              isLoading={isLoading}
            />
          </>
        )}
      </div>
    </>
  )
}
