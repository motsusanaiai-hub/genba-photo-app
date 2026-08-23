import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { usePhotoStore } from '@/store/photoStore'
import { insertCloudProjects, updateCloudProject, deleteCloudProjectCascade } from '@/lib/cloudSync'
import { canCreateProject } from '@/lib/plan'
import type { Project, ProjectFormData, ProjectWithCount } from '@/types/project'

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

  // 新規現場作成の可否は、常にこのuserProjects.length（現在ログイン中ユーザーの
  // 現存件数のみ）を唯一の判定元とする。他ユーザー分を混ぜたり、累計作成数の
  // ようなカウンタは持たない。
  const canCreateNewProject = canCreateProject(user?.plan ?? 'free', userProjects.length)

  const createProject = async (data: ProjectFormData): Promise<Project | null> => {
    // UI側のボタン無効化・案内表示だけに頼らず、作成処理自体でも上限を再チェックする
    // （URL直打ち等でこの関数が直接呼ばれた場合の二重防御）。
    if (!canCreateNewProject) return null

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
    // ローカル（localStorage上のprojects/photosメタ、IndexedDB上の写真本体）は
    // 意図的に一切削除しない。現場削除後も端末内に写真データを残す仕様のため。
    deleteProject(id)
    const result = await deleteCloudProjectCascade(id)
    if (!result.projectDeleted || !result.photosDeleted || !result.storageDeleted) {
      console.error('[useProjects] removeProject: cloud側の削除が一部失敗しました。状況を確認してください:', id, result)
    }
  }

  const getProject = (id: string) => projects.find((p) => p.id === id)

  return {
    projects: userProjects,
    canCreateNewProject,
    createProject,
    editProject,
    removeProject,
    getProject,
  }
}
