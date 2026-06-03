import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { Header } from '@/components/layout/Header'
import { ProjectForm } from '@/components/project/ProjectForm'
import { Button } from '@/components/ui/button'
import type { ProjectFormData } from '@/types/project'

export function ProjectNewPage() {
  const navigate = useNavigate()
  const { createProject } = useProjects()
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (data: ProjectFormData) => {
    setIsLoading(true)
    const project = createProject(data)
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
        <ProjectForm
          onSubmit={handleSubmit}
          submitLabel="登録する"
          isLoading={isLoading}
        />
      </div>
    </>
  )
}
