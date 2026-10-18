import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// クラウド画像の取得を、実際の Supabase クライアント（モック）とログイン状態につなぐ部分。
// 公開URL（getPublicUrl）が使われないこと、ログアウト・ユーザー切り替え・削除でキャッシュが捨てられることを確認する。
// 外部サービスには接続しない（Supabase はすべてモック）。

const mocks = vi.hoisted(() => {
  const state = {
    signCalls: [] as Array<{ bucket: string; paths: string[]; ttl: number }>,
    downloadCalls: [] as Array<{ bucket: string; path: string }>,
    removeCalls: [] as Array<{ bucket: string; paths: string[] }>,
    publicUrlCalls: 0,
    counter: 0,
    photoRows: [{ storage_path: 'user-a/p1.jpg' }, { storage_path: 'user-a/p2.jpg' }, { storage_path: null }] as Array<{
      storage_path: string | null
    }>,
    dbCalls: [] as string[],
  }

  // from('photos').select(..).eq(..) / .delete().eq(..)、from('projects').update(..).eq(..) を受け付ける最小のフェイク
  const builder = (table: string) => {
    const done = (label: string) => {
      state.dbCalls.push(`${table}.${label}`)
      return Promise.resolve({ data: label === 'select' ? state.photoRows : null, error: null })
    }
    const make = (label: string) => ({ eq: () => done(label) })
    return {
      select: () => make('select'),
      delete: () => make('delete'),
      update: () => make('update'),
    }
  }

  const supabase = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], ttl: number) => {
          state.signCalls.push({ bucket, paths: [...paths], ttl })
          return {
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=${++state.counter}`, error: null })),
            error: null,
          }
        },
        download: async (path: string) => {
          state.downloadCalls.push({ bucket, path })
          return { data: new Blob([path]), error: null }
        },
        remove: async (paths: string[]) => {
          state.removeCalls.push({ bucket, paths: [...paths] })
          return { data: null, error: null }
        },
        getPublicUrl: () => {
          state.publicUrlCalls++
          throw new Error('getPublicUrl must not be used')
        },
      }),
    },
    from: (table: string) => builder(table),
  }
  return { state, supabase }
})

vi.mock('@/lib/supabase', () => ({
  supabase: mocks.supabase,
  isSupabaseConfigured: true,
  authMode: 'supabase',
}))

import { useAuthStore } from '@/store/authStore'
import {
  evictCloudPhotos,
  getCloudPhotoAccess,
  loadPhotoDisplayUrl,
  refreshPhotoDisplayUrl,
} from '@/lib/cloudPhotoCache'
import { deleteCloudProjectCascade, downloadCloudCompressed, removeCompressedFromCloud } from '@/lib/cloudSync'

const userOf = (id: string) => ({ id, email: `${id}@example.com`, display_name: id, plan: 'free' as const })
const login = (id: string | null) => useAuthStore.setState({ user: id ? userOf(id) : null })
const settle = () => new Promise((r) => setTimeout(r, 5))

let fetchSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  login(null)
  getCloudPhotoAccess().clear()
  const { state } = mocks
  state.signCalls.length = 0
  state.downloadCalls.length = 0
  state.removeCalls.length = 0
  state.dbCalls.length = 0
  state.publicUrlCalls = 0
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be used for photos'))
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('実際の Storage API への接続（モック）', () => {
  it('アプリ全体で1つのインスタンスを使う', () => {
    expect(getCloudPhotoAccess()).toBe(getCloudPhotoAccess())
  })

  it('ログイン中のユーザーとして、バケット photo-compressed の署名付きURLを有効期限1時間で取得する', async () => {
    login('user-a')
    const url = await getCloudPhotoAccess().getSignedUrl('user-a/p1.jpg')
    expect(url).toMatch(/^https:\/\/signed\.example\/user-a\/p1\.jpg/)
    expect(mocks.state.signCalls).toEqual([{ bucket: 'photo-compressed', paths: ['user-a/p1.jpg'], ttl: 3600 }])
    expect(mocks.state.publicUrlCalls).toBe(0)
  })

  it('未ログインでは、Storage に通信しない', async () => {
    expect(await getCloudPhotoAccess().getSignedUrl('user-a/p1.jpg')).toBeNull()
    expect(await getCloudPhotoAccess().downloadBlob('user-a/p1.jpg')).toBeNull()
    expect(mocks.state.signCalls).toHaveLength(0)
    expect(mocks.state.downloadCalls).toHaveLength(0)
  })
})

describe('ログアウト・ユーザー切り替えでキャッシュを破棄する', () => {
  it('ログアウトすると、前のユーザーの署名付きURLは使えなくなる', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    await access.getSignedUrl('user-a/p1.jpg')
    expect(access.peek('user-a/p1.jpg')).not.toBeNull()

    login(null)
    expect(access.peek('user-a/p1.jpg')).toBeNull()
    expect(await access.getSignedUrl('user-a/p1.jpg')).toBeNull() // 未ログインでは取得もできない
  })

  it('ログアウトしてから同じユーザーで再ログインしても、ログアウト前の署名付きURLは使わず、取得し直す', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    const before = await access.getSignedUrl('user-a/p1.jpg')

    login(null) // ログアウト → キャッシュを全て破棄
    login('user-a') // 同じユーザーで再ログイン
    expect(access.peek('user-a/p1.jpg')).toBeNull()
    const after = await access.getSignedUrl('user-a/p1.jpg')
    expect(after).not.toBe(before)
    expect(mocks.state.signCalls).toHaveLength(2)
  })

  it('別のユーザーでログインし直したら、前のユーザーのURLは使わず、取得し直す', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    const forA = await access.getSignedUrl('user-a/p1.jpg')
    login('user-b')
    expect(access.peek('user-a/p1.jpg')).toBeNull()
    const forB = await access.getSignedUrl('user-a/p1.jpg')
    expect(forB).not.toBe(forA)
    expect(mocks.state.signCalls).toHaveLength(2)
  })

  it('同じユーザーのままユーザー情報が更新されただけ（トークン更新など）では、破棄しない', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    await access.getSignedUrl('user-a/p1.jpg')
    useAuthStore.setState({ user: { ...userOf('user-a'), display_name: '更新後', plan: 'pro' } })
    expect(access.peek('user-a/p1.jpg')).not.toBeNull()
    expect(mocks.state.signCalls).toHaveLength(1)
  })
})

describe('表示用URLの補助（ライトボックス・撮影オーバーレイ）', () => {
  it('端末内の画像（base64）があれば、それを返す。通信しない', async () => {
    login('user-a')
    const url = await loadPhotoDisplayUrl({ thumbnail_data_url: 'data:image/jpeg;base64,AAA', storage_path: 'user-a/p1.jpg' })
    expect(url).toBe('data:image/jpeg;base64,AAA')
    expect(mocks.state.signCalls).toHaveLength(0)
  })

  it('端末内の画像が無ければ、クラウドから署名付きURLを取得する', async () => {
    login('user-a')
    const url = await loadPhotoDisplayUrl({ thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    expect(url).toMatch(/^https:\/\/signed\.example\//)
  })

  it('storage_path が null で端末内の画像も無ければ null', async () => {
    login('user-a')
    expect(await loadPhotoDisplayUrl({ thumbnail_data_url: '', storage_path: null })).toBeNull()
    expect(mocks.state.signCalls).toHaveLength(0)
  })

  it('refreshPhotoDisplayUrl はクラウドの画像だけ作り直す（端末内の画像・パスなしは対象外）', async () => {
    login('user-a')
    const first = await loadPhotoDisplayUrl({ thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    const refreshed = await refreshPhotoDisplayUrl({ thumbnail_data_url: '', storage_path: 'user-a/p1.jpg' })
    expect(refreshed).not.toBe(first)
    expect(await refreshPhotoDisplayUrl({ thumbnail_data_url: 'data:x', storage_path: 'user-a/p1.jpg' })).toBeNull()
    expect(await refreshPhotoDisplayUrl({ thumbnail_data_url: '', storage_path: null })).toBeNull()
  })
})

describe('ZIP・Excel 用の取得（downloadCloudCompressed）', () => {
  it('公開URLを fetch せず、本人の認証で Storage から取得する', async () => {
    login('user-a')
    const blob = await downloadCloudCompressed('user-a/p1.jpg')
    expect(blob).toBeInstanceOf(Blob)
    expect(mocks.state.downloadCalls).toEqual([{ bucket: 'photo-compressed', path: 'user-a/p1.jpg' }])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.state.publicUrlCalls).toBe(0)
  })

  it('未ログインでは取得せず null（既存の警告とスキップ処理に任せる）', async () => {
    expect(await downloadCloudCompressed('user-a/p1.jpg')).toBeNull()
    expect(mocks.state.downloadCalls).toHaveLength(0)
  })
})

describe('写真・工事案件の削除でキャッシュを捨てる', () => {
  it('写真を削除（removeCompressedFromCloud）すると、その写真の署名付きURLのキャッシュを捨てる', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    await access.getSignedUrl('user-a/p1.jpg')
    await access.getSignedUrl('user-a/p2.jpg')

    await removeCompressedFromCloud('user-a/p1.jpg')
    expect(mocks.state.removeCalls).toEqual([{ bucket: 'photo-compressed', paths: ['user-a/p1.jpg'] }])
    expect(access.peek('user-a/p1.jpg')).toBeNull()
    expect(access.peek('user-a/p2.jpg')).not.toBeNull()
  })

  it('工事案件を削除（deleteCloudProjectCascade）すると、その工事の写真のキャッシュを捨てる', async () => {
    login('user-a')
    const access = getCloudPhotoAccess()
    await access.getSignedUrl('user-a/p1.jpg')
    await access.getSignedUrl('user-a/p2.jpg')
    await access.getSignedUrl('user-a/other-project.jpg')

    const result = await deleteCloudProjectCascade('project-1')
    expect(result).toMatchObject({ storageDeleted: true, photosDeleted: true, projectDeleted: true })
    expect(mocks.state.removeCalls).toEqual([{ bucket: 'photo-compressed', paths: ['user-a/p1.jpg', 'user-a/p2.jpg'] }])
    expect(access.peek('user-a/p1.jpg')).toBeNull()
    expect(access.peek('user-a/p2.jpg')).toBeNull()
    expect(access.peek('user-a/other-project.jpg')).not.toBeNull()
    // 従来どおりの削除手順（写真の行の削除 → 工事案件の論理削除）は変わらない
    expect(mocks.state.dbCalls).toEqual(['photos.select', 'photos.delete', 'projects.update'])
  })

  it('キャッシュに無いパスや空の指定でも、エラーにならない', () => {
    expect(() => evictCloudPhotos([null, undefined, '', 'user-a/none.jpg'])).not.toThrow()
  })
})

describe('Supabase 未設定（開発モード）', () => {
  it('Storage への接続は常に失敗として扱われ、例外にならない', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: false, authMode: 'mock' }))
    const { realStorage } = await import('@/lib/cloudPhotoCache')
    const signed = await realStorage.createSignedUrls(['a.jpg'], 3600)
    expect(signed.data).toBeNull()
    expect(signed.error).not.toBeNull()
    const downloaded = await realStorage.download('a.jpg')
    expect(downloaded.data).toBeNull()
    expect(downloaded.error).not.toBeNull()
    vi.doUnmock('@/lib/supabase')
    await settle()
  })
})
