import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { usePhotoStore } from '@/store/photoStore'
import { insertCloudProjects, updateCloudProject, deleteCloudProject } from '@/lib/cloudSync'
import type { ProjectFormData, ProjectWithCount } from '@/types/project'

export function useProjects() {
  const user = useAuthStore((s) => s.user)
  const { projects, addProject, updateProject, deleteProject } = useProjectStore()
  const { photos } = usePhotoStore()

  // ログインユーザーのプロジェクトのみ、更新日降順
  const userProjects: ProjectWithCount[] = projects
    .filter((p) => p.user_id === (user?.id ?? ''))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((p) => ({
      ...p,
      photo_count: photos.filter((ph) => ph.project_id === p.id).length,
    }))

  const createProject = async (data: ProjectFormData) => {
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
    await insertCloudProjects([project])
    return project
  }

  const editProject = async (id: string, data: ProjectFormData) => {
    const update = {
      name: data.name,
      location: data.location,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
    }
    updateProject(id, update)
    await updateCloudProject(id, update)
  }

  const removeProject = async (id: string) => {
    deleteProject(id)
    await deleteCloudProject(id)
  }

  const getProject = (id: string) => projects.find((p) => p.id === id)

  return { projects: userProjects, createProject, editProject, removeProject, getProject }
}
