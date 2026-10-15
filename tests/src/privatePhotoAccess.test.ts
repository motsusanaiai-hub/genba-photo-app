import { readFileSync, readdirSync, statSync } from 'node:fs'
import nodePath from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Storage を将来 private にしても、画像取得処理を変えずに済む設計の確認（今は public のままでも動く）。
//   - 公開URLに依存しない（getPublicUrl を使わない）
//   - 画面は、端末内の画像を優先し、なければクラウドの画像を本人の認証で取得する
//   - アップロード・同期・Helper 連携（create-genbafoto-job）の処理は変えていない
// 外部サービスには接続しない（Supabase はモック）。

const mocks = vi.hoisted(() => ({
  signCalls: 0,
  supabase: {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          mocks.signCalls++
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=1`, error: null })), error: null }
        },
        download: async () => ({ data: null, error: null }),
      }),
    },
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: mocks.supabase, isSupabaseConfigured: true, authMode: 'supabase' }))

// zustand のフックは、サーバー描画では初期状態しか返さないため、現在の状態を読むフックに差し替える（adSlot.test.ts と同じ方法）
vi.mock('@/store/authStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<{ user: { id: string } | null }>(() => ({ user: null }))
  const useAuthStore = Object.assign(
    <T>(selector: (s: ReturnType<typeof store.getState>) => T) => selector(store.getState()),
    store,
  )
  return { useAuthStore }
})

import { useAuthStore } from '@/store/authStore'
import { getCloudPhotoAccess } from '@/lib/cloudPhotoCache'
import { PhotoImage } from '@/components/photo/PhotoImage'

const ROOT = nodePath.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(nodePath.join(ROOT, file), 'utf8')
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = nodePath.join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const render = (photo: { id: string; thumbnail_data_url: string; storage_path: string | null }) =>
  renderToStaticMarkup(createElement(PhotoImage, { photo, alt: '写真A', className: 'w-full h-full object-cover' }))
const login = (id: string | null) => (useAuthStore as unknown as { setState: (s: unknown) => void }).setState({ user: id ? { id } : null })

beforeEach(() => {
  login(null)
  getCloudPhotoAccess().clear()
  mocks.signCalls = 0
})

describe('写真の表示（PhotoImage）', () => {
  it('IndexedDB 由来の端末内の画像（base64）がある → そのまま表示。クラウドには通信しない', () => {
    login('user-a')
    const html = render({ id: 'p1', thumbnail_data_url: 'data:image/jpeg;base64,AAA', storage_path: 'user-a/p1.jpg' })
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/jpeg;base64,AAA"')
    expect(html).toContain('loading="lazy"')
    expect(mocks.signCalls).toBe(0)
  })

  it('クラウドにだけある画像で、取得済みのURLがある → 署名付きURLの画像を、最初の表示から出す', async () => {
    login('user-a')
    await getCloudPhotoAccess().getSignedUrl('user-a/p1.jpg')
    const html = render({ id: 'p1', thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    expect(html).toContain('src="https://signed.example/user-a/p1.jpg?token=1"')
    expect(mocks.signCalls).toBe(1)
  })

  it('クラウドにだけある画像で、まだ取得していない → 読み込み中のプレースホルダー（同じサイズ・同じ className）', () => {
    login('user-a')
    const html = render({ id: 'p1', thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    expect(html).not.toContain('<img')
    expect(html).toContain('data-photo-image-status="loading"')
    expect(html).toContain('animate-pulse')
    expect(html).toContain('w-full h-full object-cover') // レイアウトを変えない
  })

  it('storage_path が null で端末内の画像も無い → 代替表示（画面全体は止まらない）', () => {
    login('user-a')
    const html = render({ id: 'p1', thumbnail_data_url: '', storage_path: null })
    expect(html).not.toContain('<img')
    expect(html).toContain('data-photo-image-status="failed"')
    expect(html).toContain('画像を表示できません')
  })

  it('ログアウト後は、前のユーザーのURLが取得済みでも表示しない', async () => {
    login('user-a')
    await getCloudPhotoAccess().getSignedUrl('user-a/p1.jpg')
    login(null)
    getCloudPhotoAccess().clear() // 実際は authStore の購読が行う（cloudPhotoCache.test.ts で確認）
    const html = render({ id: 'p1', thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    expect(html).not.toContain('signed.example')
    expect(html).toContain('data-photo-image-status="failed"')
  })
})

describe('公開URLへの依存がない', () => {
  const files = sourceFiles(nodePath.join(ROOT, 'src')).map((f) => nodePath.relative(ROOT, f).split(nodePath.sep).join('/'))

  it('アプリのコードのどこにも getPublicUrl・公開URLのパスがない', () => {
    const found = files.filter((f) => /getPublicUrl|\/object\/public\//.test(code(f)))
    expect(found).toEqual([])
  })

  it('旧 API（getCloudPhotoUrl・resolvePhotoThumbUrl）は残っていない', () => {
    const found = files.filter((f) => /getCloudPhotoUrl|resolvePhotoThumbUrl/.test(code(f)))
    expect(found).toEqual([])
  })

  it('service_role キーを、ブラウザのコードに渡していない', () => {
    const found = files.filter((f) => /service_role|SERVICE_ROLE/i.test(code(f)))
    expect(found).toEqual([])
  })

  it('画像表示のコンポーネントは、画像の取得を共通処理（PhotoImage / cloudPhotoCache）に任せている', () => {
    for (const file of [
      'src/components/photo/PhotoCard.tsx',
      'src/components/photo/LedgerRow.tsx',
      'src/components/photo/PhotoActionSheet.tsx',
      'src/components/photo/ReferencePhotoPicker.tsx',
    ]) {
      expect(read(file)).toContain("from './PhotoImage'")
      expect(code(file)).not.toMatch(/<img[^>]*src=\{resolve|supabase|storage\.from/)
    }
    for (const file of ['src/components/photo/PhotoLightbox.tsx', 'src/components/photo/OverlayCameraView.tsx']) {
      // 画像の取得は usePhotoDisplay（photoDisplayController）が cloudPhotoCache 経由で行う
      expect(read(file)).toContain("from '@/hooks/usePhotoDisplay'")
      expect(code(file)).not.toMatch(/supabase|storage\.from/)
    }
    expect(read('src/hooks/usePhotoDisplay.ts')).toContain("from '@/lib/cloudPhotoCache'")
  })

  it('ライトボックス・撮影オーバーレイは、IndexedDB の元画像を優先し、失効時はURLを1度だけ作り直す', () => {
    for (const file of ['src/components/photo/PhotoLightbox.tsx', 'src/components/photo/OverlayCameraView.tsx']) {
      expect(code(file)).toMatch(/onError=\{handle(Image|Overlay)Error\}/)
    }
    // 取得の順序と再取得は共通の controller（動作は photoDisplayController.test.ts で確認）
    expect(code('src/hooks/usePhotoDisplay.ts')).toContain('photoStorage.getObjectURL(')
    expect(code('src/hooks/usePhotoDisplay.ts')).toContain('refreshDisplayUrl: refreshPhotoDisplayUrl')
  })
})

describe('アップロード・同期・Helper 連携は変えていない', () => {
  it('アップロード処理：保存パスは ユーザーID/写真ID.jpg、upsert で圧縮画像を保存する', () => {
    const source = code('src/lib/cloudSync.ts')
    expect(source).toContain('const path = `${userId}/${photoId}.jpg`')
    expect(source).toMatch(/\.upload\(path, blob, \{\s*contentType: 'image\/jpeg',\s*upsert: true,?\s*\}\)/)
    expect(source).toContain('export async function insertCloudPhotos')
    expect(source).toContain('export async function updateCloudPhoto')
  })

  it('写真の取り込み・同期のコードは、画像表示の共通処理を参照していない（影響し合わない）', () => {
    for (const file of ['src/hooks/usePhotos.ts', 'src/hooks/useCloudSync.ts', 'src/lib/photoStorage.ts']) {
      expect(code(file)).not.toMatch(/cloudPhotoAccess|cloudPhotoCache|PhotoImageLoader|usePhotoImageSrc/)
    }
  })

  it('高互換 Excel（create-genbafoto-job）：署名は引き続きサーバー側。認可の確認（STEP 7-A）・有効期限・応答形式は変更なし', () => {
    const source = code('api/create-genbafoto-job.ts')
    expect(source).toContain('validatePhotoAccess(')
    expect(source).toContain('const SIGNED_URL_TTL_SECONDS = 1800')
    expect(source).toContain('createSignedUrls(batchPaths, SIGNED_URL_TTL_SECONDS)')
    expect(source).toMatch(/res\.status\(200\)\.json\(\{\s*expiresAt,\s*photos: signedResults,?\s*\}\)/)
    // Web 側の .genbafoto の組み立て・Windows Helper には、画像取得の共通処理を持ち込んでいない
    expect(code('src/lib/generateGenbafotoJob.ts')).not.toMatch(/cloudPhotoAccess|cloudPhotoCache/)
  })

  it('ZIP・Excel の出力は、getPhotoJpegBlob → downloadCloudCompressed（認証付き）を通る', () => {
    expect(code('src/lib/generateExcel.ts')).toContain('downloadCloudCompressed(photo.storage_path)')
    expect(code('src/lib/cloudSync.ts')).toContain('getCloudPhotoAccess().downloadBlob(storagePath)')
    expect(code('src/lib/generateZip.ts')).toContain('getPhotoJpegBlob(photo)')
  })
})
