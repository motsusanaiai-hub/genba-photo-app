import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Photo } from '@/types/photo'

interface PhotoState {
  photos: Photo[]
  addPhotos: (photos: Photo[]) => void
  updatePhoto: (id: string, data: Partial<Photo>) => void
  deletePhoto: (id: string) => void
}

export const usePhotoStore = create<PhotoState>()(
  persist(
    (set) => ({
      photos: [],
      addPhotos: (newPhotos) =>
        set((state) => ({ photos: [...state.photos, ...newPhotos] })),
      updatePhoto: (id, data) =>
        set((state) => ({
          photos: state.photos.map((p) =>
            p.id === id ? { ...p, ...data, updated_at: new Date().toISOString() } : p,
          ),
        })),
      deletePhoto: (id) =>
        set((state) => ({ photos: state.photos.filter((p) => p.id !== id) })),
    }),
    { name: 'genba-photos' },
  ),
)
