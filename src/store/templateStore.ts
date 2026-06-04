import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CustomTemplate {
  id: string
  text: string
  created_at: string
}

interface TemplateState {
  customTemplates: CustomTemplate[]
  recentComments: string[]   // 新→旧順、最大10件
  addCustomTemplate: (text: string) => void
  removeCustomTemplate: (id: string) => void
  addRecentComment: (text: string) => void
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      customTemplates: [],
      recentComments: [],

      addCustomTemplate: (text) =>
        set((state) => ({
          customTemplates: [
            ...state.customTemplates,
            { id: crypto.randomUUID(), text, created_at: new Date().toISOString() },
          ],
        })),

      removeCustomTemplate: (id) =>
        set((state) => ({
          customTemplates: state.customTemplates.filter((t) => t.id !== id),
        })),

      addRecentComment: (text) =>
        set((state) => {
          const deduped = state.recentComments.filter((c) => c !== text)
          return { recentComments: [text, ...deduped].slice(0, 10) }
        }),
    }),
    { name: 'genba-templates' },
  ),
)
