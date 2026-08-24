import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PhotoFolder } from '@/types/photo'

interface FolderState {
  folders: PhotoFolder[]
  setFolders: (folders: PhotoFolder[]) => void
  addFolder: (folder: PhotoFolder) => void
  updateFolder: (id: string, data: Partial<PhotoFolder>) => void
  deleteFolder: (id: string) => void
}

export const useFolderStore = create<FolderState>()(
  persist(
    (set) => ({
      folders: [],
      setFolders: (folders) => set({ folders }),
      addFolder: (folder) =>
        set((state) => ({ folders: [...state.folders, folder] })),
      updateFolder: (id, data) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, ...data, updated_at: new Date().toISOString() } : f,
          ),
        })),
      deleteFolder: (id) =>
        set((state) => ({ folders: state.folders.filter((f) => f.id !== id) })),
    }),
    { name: 'genba-photo-folders' },
  ),
)
