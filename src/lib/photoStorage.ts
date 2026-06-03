import { get, set, del } from 'idb-keyval'

const key = (id: string) => `photo:${id}`

/**
 * オリジナル写真ファイルを IndexedDB に保存・取得・削除するラッパー。
 * Supabase 移行時はこのファイルを Storage API の呼び出しに差し替える。
 */
export const photoStorage = {
  async save(id: string, file: File): Promise<void> {
    try {
      await set(key(id), file)
    } catch (e) {
      console.warn('photoStorage.save failed:', e)
    }
  },

  async getObjectURL(id: string): Promise<string | null> {
    try {
      const blob = await get<Blob>(key(id))
      if (!blob) return null
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await del(key(id))
    } catch (e) {
      console.warn('photoStorage.remove failed:', e)
    }
  },
}
