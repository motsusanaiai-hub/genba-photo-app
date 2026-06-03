import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import type { ProjectFormData, ProjectWithCount } from '@/types/project'

export function useProjects() {
  const user = useAuthStore((s) => s.user)
  const { projects, addProject, updateProject, deleteProject } = useProjectStore()

  // ログインユーザーのプロジェクトのみ、更新日降順
  const userProjects: ProjectWithCount[] = projects
    .filter((p) => p.user_id === (user?.id ?? ''))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((p) => ({ ...p, photo_count: 0 })) // Week 3 で photos から計算

  const createProject = (data: ProjectFormData) => {
    const now = new Date().toISOString()
    const project = {
      id: crypto.randomUUID(),
      user_id: user?.id ?? '',
      name: data.name,
      location: data.location,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      status: 'active' as const,
      cover_photo_id: null,
      created_at: now,
      updated_at: now,
    }
    addProject(project)
    return project
  }

  const editProject = (id: string, data: ProjectFormData) => {
    updateProject(id, {
      name: data.name,
      location: data.location,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
    })
  }

  const removeProject = (id: string) => {
    deleteProject(id)
  }

  const getProject = (id: string) => projects.find((p) => p.id === id)

  return { projects: userProjects, createProject, editProject, removeProject, getProject }
}
