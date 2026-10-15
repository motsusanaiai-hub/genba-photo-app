import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// H-1: 同じ端末でユーザーを切り替えたとき、前のユーザーの工事案件・写真を表示・編集・削除できないこと。
// ログアウトしても端末内のデータ（localStorage・IndexedDB）は消さない設計なので、「消す」のではなく
// 「ログイン中のユーザーのものだけ扱う」ことで分離する。外部サービスには接続しない（全てモック）。

const mocks = vi.hoisted(() => ({
  cloud: {
    insertCloudProjects: vi.fn(async () => {}),
    updateCloudProject: vi.fn(async () => {}),
    deleteCloudProjectCascade: vi.fn(async () => ({ projectDeleted: true, photosDeleted: true, storageDeleted: true })),
    insertCloudPhotos: vi.fn(async () => {}),
    updateCloudPhoto: vi.fn(async () => {}),
    deleteCloudPhoto: vi.fn(async () => {}),
    uploadCompressedToCloud: vi.fn(async () => 'u/p.jpg'),
    removeCompressedFromCloud: vi.fn(async () => {}),
    insertCloudFolders: vi.fn(async () => {}),
    updateCloudFolder: vi.fn(async () => {}),
    deleteCloudFolder: vi.fn(async () => {}),
  },
  storage: {
    save: vi.fn(async () => {}),
    saveCompressed: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    removeCompressed: vi.fn(async () => {}),
  },
}))
vi.mock('@/lib/cloudSync', () => mocks.cloud)
vi.mock('@/lib/photoStorage', () => ({ photoStorage: mocks.storage }))
vi.mock('@/utils/imageUtils', () => ({
  generateThumbnail: async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10, failed: false }),
  generateCompressedImage: async () => new Blob(['x']),
  resolveTakenAt: async () => null,
}))

// zustand のフックは、サーバー描画では初期状態しか返さないため、現在の状態を読むフックに差し替える
vi.mock('@/store/authStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<{ user: { id: string; plan: string } | null; initialized: boolean }>(() => ({
    user: null,
    initialized: true,
  }))
  const useAuthStore = Object.assign(
    <T>(selector: (s: ReturnType<typeof store.getState>) => T) => selector(store.getState()),
    store,
  )
  return { useAuthStore }
})
vi.mock('@/store/projectStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<any>((set) => ({
    projects: [],
    setProjects: (projects: any[]) => set({ projects }),
    addProject: (p: any) => set((s: any) => ({ projects: [...s.projects, p] })),
    updateProject: (id: string, d: any) => set((s: any) => ({ projects: s.projects.map((p: any) => (p.id === id ? { ...p, ...d } : p)) })),
    deleteProject: (id: string) => set((s: any) => ({ projects: s.projects.filter((p: any) => p.id !== id) })),
  }))
  const useProjectStore = Object.assign((selector?: (s: any) => any) => (selector ? selector(store.getState()) : store.getState()), store)
  return { useProjectStore }
})
vi.mock('@/store/photoStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<any>((set) => ({
    photos: [],
    setPhotos: (photos: any[]) => set({ photos }),
    addPhotos: (n: any[]) => set((s: any) => ({ photos: [...s.photos, ...n] })),
    updatePhoto: (id: string, d: any) => set((s: any) => ({ photos: s.photos.map((p: any) => (p.id === id ? { ...p, ...d } : p)) })),
    deletePhoto: (id: string) => set((s: any) => ({ photos: s.photos.filter((p: any) => p.id !== id) })),
  }))
  const usePhotoStore = Object.assign((selector?: (s: any) => any) => (selector ? selector(store.getState()) : store.getState()), store)
  return { usePhotoStore }
})
vi.mock('@/store/folderStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<any>((set) => ({
    folders: [],
    setFolders: (folders: any[]) => set({ folders }),
    addFolder: (f: any) => set((s: any) => ({ folders: [...s.folders, f] })),
    updateFolder: (id: string, d: any) => set((s: any) => ({ folders: s.folders.map((f: any) => (f.id === id ? { ...f, ...d } : f)) })),
    deleteFolder: (id: string) => set((s: any) => ({ folders: s.folders.filter((f: any) => f.id !== id) })),
  }))
  const useFolderStore = Object.assign((selector?: (s: any) => any) => (selector ? selector(store.getState()) : store.getState()), store)
  return { useFolderStore }
})

import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { usePhotoStore } from '@/store/photoStore'
import { useFolderStore } from '@/store/folderStore'
import { useProjects } from '@/hooks/useProjects'
import { usePhotos } from '@/hooks/usePhotos'
import { usePhotoFolders } from '@/hooks/usePhotoFolders'

type AnyStore = { getState: () => any; setState: (s: any) => void }
const auth = useAuthStore as unknown as AnyStore
const projectStore = useProjectStore as unknown as AnyStore
const photoStore = usePhotoStore as unknown as AnyStore
const folderStore = useFolderStore as unknown as AnyStore

const login = (id: string | null, initialized = true) =>
  auth.setState({ user: id ? { id, plan: 'free' } : null, initialized })

/** フックを1回だけ描画し、戻り値を取り出す */
function hook<T>(fn: () => T): T {
  let out!: T
  const Probe = () => {
    out = fn()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return out
}

const NOW = '2026-01-01T00:00:00.000Z'
const project = (id: string, user_id: string) => ({
  id, user_id, name: `工事${id}`, location: '場所', start_date: null, end_date: null,
  status: 'active', cover_photo_id: null, created_at: NOW, updated_at: NOW,
})
const photo = (id: string, project_id: string, user_id: string, sort_order = 1000) => ({
  id, project_id, user_id, original_filename: `${id}.jpg`, file_size: 1, width: 1, height: 1, taken_at: null,
  comment: '', floor: '', location: '', sort_order, phase: null, folder_id: null, previous_folder_id: null,
  thumbnail_data_url: `data:image/jpeg;base64,${id}`, storage_path: `${user_id}/${id}.jpg`,
  created_at: NOW, updated_at: NOW, format_warning: false,
})
const folder = (id: string, project_id: string, user_id: string) => ({
  id, project_id, user_id, name: `F${id}`, parent_folder_id: null, sort_order: 1000, created_at: NOW, updated_at: NOW,
})

const A_PROJECT = 'proj-a'
const B_PROJECT = 'proj-b'

beforeEach(() => {
  Object.values(mocks.cloud).forEach((f) => f.mockClear())
  Object.values(mocks.storage).forEach((f) => f.mockClear())
  projectStore.setState({ projects: [project(A_PROJECT, 'user-a'), project(B_PROJECT, 'user-b')] })
  photoStore.setState({
    photos: [
      photo('a1', A_PROJECT, 'user-a', 1000),
      photo('a2', A_PROJECT, 'user-a', 2000),
      photo('b1', B_PROJECT, 'user-b', 1000),
    ],
  })
  folderStore.setState({ folders: [folder('fa', A_PROJECT, 'user-a'), folder('fb', B_PROJECT, 'user-b')] })
  login(null)
})

describe('H-1 再現: ユーザーAの工事案件をユーザーBが開けてしまう', () => {
  it('ユーザーBがAの工事案件IDを直接指定しても、getProject は何も返さない', () => {
    login('user-b')
    expect(hook(() => useProjects()).getProject(A_PROJECT)).toBeUndefined()
  })

  it('ユーザーBがAの工事案件IDを指定しても、usePhotos は写真を返さない', () => {
    login('user-b')
    expect(hook(() => usePhotos(A_PROJECT)).photos).toEqual([])
  })
})

describe('工事案件の所有者確認（getProject）', () => {
  it('自分の工事案件は取得できる', () => {
    login('user-a')
    expect(hook(() => useProjects()).getProject(A_PROJECT)?.id).toBe(A_PROJECT)
  })

  it('他人の工事案件・存在しない工事案件・空のIDは undefined（存在の有無を区別させない）', () => {
    login('user-a')
    const { getProject } = hook(() => useProjects())
    expect(getProject(B_PROJECT)).toBeUndefined()
    expect(getProject('no-such-project')).toBeUndefined()
    expect(getProject('')).toBeUndefined()
  })

  it('未ログインでは、どの工事案件も取得できない', () => {
    login(null)
    const { getProject } = hook(() => useProjects())
    expect(getProject(A_PROJECT)).toBeUndefined()
    expect(getProject(B_PROJECT)).toBeUndefined()
  })

  it('認証の確認前（initialized=false）は、ユーザー情報があっても取得できない', () => {
    login('user-a', false)
    expect(hook(() => useProjects()).getProject(A_PROJECT)).toBeUndefined()
  })

  it('user_id が空の工事案件は、未ログイン（空のユーザーID）でも取得できない', () => {
    projectStore.setState({ projects: [project('orphan', '')] })
    login(null)
    expect(hook(() => useProjects()).getProject('orphan')).toBeUndefined()
    login('', true)
    expect(hook(() => useProjects()).getProject('orphan')).toBeUndefined()
  })

  it('一覧は自分の工事案件だけで、写真枚数は自分の写真だけを数える', () => {
    photoStore.setState({
      photos: [photo('a1', A_PROJECT, 'user-a'), photo('x1', A_PROJECT, 'user-b')],
    })
    login('user-a')
    const list = hook(() => useProjects()).projects
    expect(list.map((p) => p.id)).toEqual([A_PROJECT])
    expect(list[0].photo_count).toBe(1)
  })
})

describe('写真の所有者確認（usePhotos）', () => {
  it('自分の工事案件の自分の写真は、並び順どおりに取得できる', () => {
    login('user-a')
    expect(hook(() => usePhotos(A_PROJECT)).photos.map((p) => p.id)).toEqual(['a1', 'a2'])
  })

  it('工事案件が自分のものでも、他人の user_id の写真は含めない', () => {
    photoStore.setState({ photos: [photo('a1', A_PROJECT, 'user-a'), photo('evil', A_PROJECT, 'user-b')] })
    login('user-a')
    expect(hook(() => usePhotos(A_PROJECT)).photos.map((p) => p.id)).toEqual(['a1'])
  })

  it('写真が自分の user_id でも、他人の工事案件の写真なら含めない', () => {
    photoStore.setState({ photos: [photo('odd', B_PROJECT, 'user-a')] })
    login('user-a')
    expect(hook(() => usePhotos(B_PROJECT)).photos).toEqual([])
  })

  it('未ログイン・認証の確認前は、写真を返さない', () => {
    login(null)
    expect(hook(() => usePhotos(A_PROJECT)).photos).toEqual([])
    login('user-a', false)
    expect(hook(() => usePhotos(A_PROJECT)).photos).toEqual([])
  })
})

describe('他人の写真の編集・削除ができない', () => {
  const snapshot = () => JSON.stringify(photoStore.getState().photos)

  it('コメント・階数場所・フェーズ・並び替え・フォルダ移動は、ローカルにもクラウドにも反映されない', async () => {
    login('user-b')
    const before = snapshot()
    const h = hook(() => usePhotos(A_PROJECT))
    await h.setComment('a1', 'のっとり')
    await h.setFloorLocation('a1', { floor: '9F', location: 'x' })
    await h.setPhase('a1', 'before')
    await h.setPhaseForPhotos(['a1', 'a2'], 'after')
    await h.reorderPhotos(['a2', 'a1'])
    await h.moveToFolder(['a1'], 'fa')
    expect(snapshot()).toBe(before)
    expect(mocks.cloud.updateCloudPhoto).not.toHaveBeenCalled()
  })

  it('他人の写真の削除は、端末内の画像・メタ情報・クラウドのどれにも及ばない', async () => {
    login('user-b')
    const h = hook(() => usePhotos(A_PROJECT))
    await h.removePhoto('a1')
    await h.removePhotos(['a1', 'a2'])
    expect(photoStore.getState().photos.map((p: any) => p.id)).toEqual(['a1', 'a2', 'b1'])
    expect(mocks.storage.remove).not.toHaveBeenCalled()
    expect(mocks.storage.removeCompressed).not.toHaveBeenCalled()
    expect(mocks.cloud.deleteCloudPhoto).not.toHaveBeenCalled()
    expect(mocks.cloud.removeCompressedFromCloud).not.toHaveBeenCalled()
  })

  it('自分の工事案件の写真IDに、他人の写真IDを混ぜても、他人の写真は削除されない', async () => {
    login('user-b')
    const h = hook(() => usePhotos(B_PROJECT))
    await h.removePhotos(['b1', 'a1'])
    expect(photoStore.getState().photos.map((p: any) => p.id)).toEqual(['a1', 'a2'])
    expect(mocks.storage.remove).toHaveBeenCalledTimes(1)
    expect(mocks.storage.remove).toHaveBeenCalledWith('b1')
  })

  it('他人の工事案件へ写真をアップロードできない（端末内にもクラウドにも保存しない）', async () => {
    login('user-b')
    const h = hook(() => usePhotos(A_PROJECT))
    const saved = await h.uploadPhotos([new File(['x'], 'x.jpg')], null, () => {})
    expect(saved).toEqual([])
    expect(photoStore.getState().photos).toHaveLength(3)
    expect(mocks.storage.save).not.toHaveBeenCalled()
    expect(mocks.cloud.uploadCompressedToCloud).not.toHaveBeenCalled()
    expect(mocks.cloud.insertCloudPhotos).not.toHaveBeenCalled()
  })

  it('自分の工事案件へのアップロードは、自分のユーザーIDで保存される', async () => {
    login('user-b')
    const h = hook(() => usePhotos(B_PROJECT))
    const saved = await h.uploadPhotos([new File(['x'], 'x.jpg')], null, () => {})
    expect(saved).toHaveLength(1)
    expect(saved[0].user_id).toBe('user-b')
    expect(saved[0].project_id).toBe(B_PROJECT)
    expect(mocks.cloud.insertCloudPhotos).toHaveBeenCalledTimes(1)
  })
})

describe('他人の工事案件・フォルダの編集・削除ができない', () => {
  it('工事案件の変更・削除は、ローカルにもクラウドにも反映されない', async () => {
    login('user-b')
    const { editProject, removeProject } = hook(() => useProjects())
    await editProject(A_PROJECT, { name: '改ざん', location: '', start_date: '', end_date: '' })
    await removeProject(A_PROJECT)
    const a = projectStore.getState().projects.find((p: any) => p.id === A_PROJECT)
    expect(a?.name).toBe(`工事${A_PROJECT}`)
    expect(mocks.cloud.updateCloudProject).not.toHaveBeenCalled()
    expect(mocks.cloud.deleteCloudProjectCascade).not.toHaveBeenCalled()
  })

  it('自分の工事案件は、変更・削除できる', async () => {
    login('user-a')
    const { editProject, removeProject } = hook(() => useProjects())
    await editProject(A_PROJECT, { name: '新名称', location: '', start_date: '', end_date: '' })
    expect(projectStore.getState().projects.find((p: any) => p.id === A_PROJECT)?.name).toBe('新名称')
    await removeProject(A_PROJECT)
    expect(projectStore.getState().projects.some((p: any) => p.id === A_PROJECT)).toBe(false)
    expect(mocks.cloud.deleteCloudProjectCascade).toHaveBeenCalledWith(A_PROJECT)
  })

  it('他人の工事案件のフォルダは、一覧に出ず、作成・名称変更・削除もできない', async () => {
    login('user-b')
    const h = hook(() => usePhotoFolders(A_PROJECT))
    expect(h.folders).toEqual([])
    expect(h.photoCountByFolder('fa')).toBe(0)
    expect(h.getFolderDeletionInfo('fa')).toEqual({ descendantFolderCount: 0, photoCount: 0 })
    await expect(h.createFolder('新規')).rejects.toThrow()
    await h.renameFolder('fa', '改ざん')
    await h.removeFolder('fa', 'deletePhotos')
    expect(folderStore.getState().folders.map((f: any) => f.id)).toEqual(['fa', 'fb'])
    expect(folderStore.getState().folders[0].name).toBe('Ffa')
    expect(mocks.cloud.insertCloudFolders).not.toHaveBeenCalled()
    expect(mocks.cloud.updateCloudFolder).not.toHaveBeenCalled()
    expect(mocks.cloud.deleteCloudFolder).not.toHaveBeenCalled()
  })
})

describe('ユーザーを切り替えたとき（A→ログアウト→B→ログアウト→A）', () => {
  it('Bには何も見えず、Aが再ログインすると自分のデータがそのまま使える（データは消えていない）', () => {
    login('user-a')
    expect(hook(() => usePhotos(A_PROJECT)).photos).toHaveLength(2)

    login(null) // ログアウト（端末内のデータは消さない）
    expect(hook(() => useProjects()).projects).toEqual([])
    expect(hook(() => usePhotos(A_PROJECT)).photos).toEqual([])

    login('user-b')
    expect(hook(() => useProjects()).getProject(A_PROJECT)).toBeUndefined()
    expect(hook(() => usePhotos(A_PROJECT)).photos).toEqual([])
    expect(hook(() => useProjects()).projects.map((p) => p.id)).toEqual([B_PROJECT])

    login(null)
    login('user-a')
    expect(hook(() => useProjects()).getProject(A_PROJECT)?.id).toBe(A_PROJECT)
    expect(hook(() => usePhotos(A_PROJECT)).photos.map((p) => p.id)).toEqual(['a1', 'a2'])
    // ストアの中身は一度も消えていない
    expect(photoStore.getState().photos).toHaveLength(3)
    expect(projectStore.getState().projects).toHaveLength(2)
  })
})

// ---- 所有者判定の関数（src/lib/ownership.ts） ----
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import {
  filterOwnedProjectFolders,
  filterOwnedProjectPhotos,
  findOwnedProject,
  isOwnedPhoto,
  ownedProjectIds,
  ownsRecord,
  resolveExportTargets,
  resolveOwnerId,
} from '@/lib/ownership'

describe('所有者判定（ownership.ts）', () => {
  const projects = [project('p1', 'user-a'), project('p2', 'user-b'), project('p3', '')] as any[]

  it('resolveOwnerId：認証の確認前・未ログイン・空IDは null', () => {
    expect(resolveOwnerId({ user: { id: 'u' }, initialized: true })).toBe('u')
    expect(resolveOwnerId({ user: { id: 'u' }, initialized: false })).toBeNull()
    expect(resolveOwnerId({ user: null, initialized: true })).toBeNull()
    expect(resolveOwnerId({ user: { id: '' }, initialized: true })).toBeNull()
  })

  it('ownsRecord / findOwnedProject：ユーザーIDが確定していなければ何も所有しない', () => {
    expect(ownsRecord('user-a', projects[0])).toBe(true)
    expect(ownsRecord('user-a', projects[1])).toBe(false)
    expect(ownsRecord(null, projects[0])).toBe(false)
    expect(ownsRecord('', projects[2])).toBe(false)
    expect(findOwnedProject(projects, 'p1', 'user-a')?.id).toBe('p1')
    expect(findOwnedProject(projects, 'p2', 'user-a')).toBeUndefined()
    expect(findOwnedProject(projects, null, 'user-a')).toBeUndefined()
    expect(ownedProjectIds(projects, 'user-a')).toEqual(new Set(['p1']))
  })

  it('写真・フォルダ：本人の工事案件に属し、user_id も本人のものだけ', () => {
    const ps = [photo('x1', 'p1', 'user-a'), photo('x2', 'p1', 'user-b'), photo('x3', 'p2', 'user-a')] as any[]
    expect(filterOwnedProjectPhotos(ps, projects, 'p1', 'user-a').map((p) => p.id)).toEqual(['x1'])
    expect(filterOwnedProjectPhotos(ps, projects, 'p2', 'user-a')).toEqual([])
    expect(isOwnedPhoto(ps[0], projects, 'user-a')).toBe(true)
    expect(isOwnedPhoto(ps[2], projects, 'user-a')).toBe(false)
    const fs = [folder('f1', 'p1', 'user-a'), folder('f2', 'p1', 'user-b')] as any[]
    expect(filterOwnedProjectFolders(fs, projects, 'p1', 'user-a').map((f) => f.id)).toEqual(['f1'])
  })

  it('resolveExportTargets：他人の工事案件は null、本人の工事案件では他人の写真を取り除く', () => {
    const ps = [photo('x1', 'p1', 'user-a'), photo('x2', 'p1', 'user-b')] as any[]
    expect(resolveExportTargets(projects[1], ps, 'user-a')).toBeNull()
    expect(resolveExportTargets(projects[0], ps, null)).toBeNull()
    expect(resolveExportTargets(projects[0], ps, 'user-a')?.photos.map((p) => p.id)).toEqual(['x1'])
  })
})

// ---- 画面・同期の組み込み確認（実際の描画は行わないため、呼び出し箇所を確認する） ----
const ROOT = nodePath.resolve(__dirname, '../..')
const code = (file: string) =>
  readFileSync(nodePath.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

describe('画面・同期への組み込み', () => {
  it('工事案件の詳細・編集画面は getProject（本人の工事案件のみ）で確認し、無ければ従来どおり一覧へ戻す', () => {
    for (const file of ['src/pages/project/ProjectDetailPage.tsx', 'src/pages/project/ProjectEditPage.tsx']) {
      const src = code(file)
      expect(src).toMatch(/getProject\(projectId \?\? ''\)/)
      expect(src).toMatch(/if \(!project\) return <Navigate to="\/" replace \/>/)
    }
  })

  it('原本の読み込み（ライトボックス・撮影オーバーレイ）は、本人の写真か確認してから IndexedDB を読む', () => {
    for (const file of ['src/components/photo/PhotoLightbox.tsx', 'src/components/photo/OverlayCameraView.tsx']) {
      expect(code(file)).toContain('usePhotoDisplay(')
    }
    expect(code('src/hooks/usePhotoDisplay.ts')).toMatch(/canAccess: isCurrentUsersPhoto/)
    const controller = code('src/lib/photoDisplayController.ts')
    expect(controller.indexOf('this.deps.canAccess(')).toBeGreaterThan(-1)
    expect(controller.indexOf('this.deps.canAccess(')).toBeLessThan(controller.indexOf('this.deps.getLocalObjectUrl('))
  })

  it('ログアウトで端末内のデータを消さない（ストア・IndexedDB・localStorage のクリア処理を持たない）', () => {
    for (const file of ['src/hooks/useAuth.ts', 'src/store/authStore.ts']) {
      let src = ''
      try { src = code(file) } catch { continue }
      expect(src).not.toMatch(/localStorage\.clear|indexedDB\.deleteDatabase|\bclear\(\)|setPhotos\(\[\]\)|setProjects\(\[\]\)/)
    }
  })

  it('クラウド同期：端末内の同期対象は本人のデータのみで、取得した行も本人のものだけを使い、他ユーザーの端末内データは書き換えない', () => {
    const src = code('src/hooks/useCloudSync.ts')
    expect(src).toMatch(/fetchedProjects\.filter\(\(p\) => p\.user_id === user\.id\)/)
    expect(src).toMatch(/fetchedPhotos\.filter\(\(p\) => p\.user_id === user\.id\)/)
    expect(src).toMatch(/fetchedFolders\.filter\(\(f\) => f\.user_id === user\.id\)/)
    expect(src).toMatch(/localProjects\.filter\(\(p\) => p\.user_id !== user\.id\)/)
    expect(src).toMatch(/localPhotos\.filter\(\(p\) => p\.user_id !== user\.id\)/)
    expect(src).toMatch(/\(p\) => p\.user_id === user\.id && !cloudPhotoIds\.has\(p\.id\)/)
    // ユーザーが切り替わったら、前のユーザーの同期の結果は反映しない
    expect(src).toMatch(/cancelled = true/)
  })
})
