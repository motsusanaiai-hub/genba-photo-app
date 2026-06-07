import { get, set, del } from 'idb-keyval'

const key            = (id: string) => `photo:${id}`
const compressedKey  = (id: string) => `photo:${id}:c:600`

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

  // ─── 600px 圧縮版（Excel 出力用）────────────────────────────

  async saveCompressed(id: string, blob: Blob): Promise<void> {
    try {
      await set(compressedKey(id), blob)
    } catch (e) {
      console.warn('photoStorage.saveCompressed failed:', e)
    }
  },

  async getCompressedBlob(id: string): Promise<Blob | null> {
    try {
      const blob = await get<Blob>(compressedKey(id))
      return blob ?? null
    } catch {
      return null
    }
  },

  async removeCompressed(id: string): Promise<void> {
    await del(compressedKey(id)).catch(() => {})
  },
}
