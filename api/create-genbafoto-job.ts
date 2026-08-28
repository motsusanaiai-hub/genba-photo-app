import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_lib/requireEnv.js'
import { createSupabaseAdminClient } from './_lib/supabaseAdmin.js'
import { isValidUuid } from './_lib/isValidUuid.js'

// Excel高互換出力（.genbafoto / C# Helper連携）用に、対象写真のSigned URLを発行するAPI。
//
// 責務はここまで：photoIdの所有権確認とSigned URL発行のみ。
// templateType・現場情報・.genbafotoそのものの組み立てはクライアント側（Web）の責務であり、
// ここには一切渡さない（渡す必要がない情報をサーバーに送らない、という方針）。
//
// 全体の流れ：
//   Authorization: Bearer <access_token> 必須
//   → supabase.auth.getUser で本人確認（クライアント申告のuserIdは一切信用しない）
//   → JWT付きクライアントで photos を select（RLSにより本人所有分だけが返る）
//   → 要求数と取得数が完全一致しない場合は「部分成功」させず全体エラー
//   → storage_pathが1件でもnull/空ならCloud同期未完了とみなし全体エラー
//   → service_roleクライアントで photo-compressed から signed URL を100件バッチで発行
//   → 1件でも発行失敗があれば全体エラー（部分成功を返さない）

const MAX_PHOTO_IDS = 300
const SIGNED_URL_TTL_SECONDS = 1800 // 30分
const SIGNED_URL_BATCH_SIZE = 100 // Supabase側の恒久的な上限ではなく、この連携APIが採用する安全なバッチサイズ

interface RequestBody {
  photoIds: string[]
}

function parseRequestBody(body: unknown): { photoIds: string[] } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'リクエスト形式が不正です' }
  }

  // 未知フィールドは無視する（他フィールドを送らない設計を推奨するが、
  // 送られてきても無視するだけで拒否はしない）。
  const raw = (body as Record<string, unknown>).photoIds

  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'photoIdsは1件以上の配列である必要があります' }
  }

  if (raw.length > MAX_PHOTO_IDS) {
    return { error: `photoIdsは最大${MAX_PHOTO_IDS}件までです` }
  }

  if (!raw.every((v): v is string => typeof v === 'string')) {
    return { error: 'photoIdsの各要素は文字列である必要があります' }
  }

  if (!raw.every((v) => isValidUuid(v))) {
    return { error: 'photoIdsに不正な形式のIDが含まれています' }
  }

  // 重複IDはここで除去する。以降はユニークなID集合を基準に「要求数と取得数の一致」を判定する
  // （同じ写真を誤って2回指定しただけの正当なリクエストを、重複だけを理由に拒否しないため）。
  const uniquePhotoIds = Array.from(new Set(raw))

  return { photoIds: uniquePhotoIds }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { values: env, missing } = requireEnv([
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const)

  if (missing.length > 0) {
    console.error('[create-genbafoto-job] missing env vars:', missing)
    res.status(500).json({ error: 'Excel高互換出力機能が現在利用できません（サーバー設定未完了）' })
    return
  }

  const authHeader = req.headers.authorization
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!accessToken) {
    res.status(401).json({ error: '認証が必要です' })
    return
  }

  let parsedBody: unknown
  try {
    parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    res.status(400).json({ error: 'リクエストボディのJSONが不正です' })
    return
  }

  const parsed = parseRequestBody(parsedBody)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { photoIds } = parsed

  // このクライアントにAuthorizationヘッダーを設定しておくことで、後続の from('photos') 呼び出しも
  // 「その認証済みユーザーとして」実行され、RLS（auth.uid() = user_id）が正しく効く。
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
  if (userError || !userData?.user) {
    res.status(401).json({ error: '認証に失敗しました' })
    return
  }

  // RLSにより、ここで返るのは「本人が所有するphotos」のみ。他人のphotoIdや存在しないphotoIdは
  // 単に結果に含まれない（含まれない理由が「存在しない」か「他人の物」かはここでは区別しない＝
  // 攻撃者に情報を与えない）。
  const { data: photoRows, error: photoError } = await supabase
    .from('photos')
    .select('id, storage_path')
    .in('id', photoIds)

  if (photoError) {
    console.error('[create-genbafoto-job] photos fetch failed:', photoError)
    res.status(500).json({ error: '写真情報の取得に失敗しました' })
    return
  }

  // 要求数と取得数が一致しない＝要求の中に「本人が所有しない（または存在しない）photoId」が
  // 混ざっている。この場合は一切signed URLを発行せず、全体を拒否する（部分成功禁止）。
  if (!photoRows || photoRows.length !== photoIds.length) {
    res.status(403).json({ error: '指定された写真の一部にアクセスできません' })
    return
  }

  // storage_pathが1件でもnull/空/不正形式なら、その写真はまだCloudへ同期されていない
  // （＝Storageに実体がない）とみなし、黙って除外せず全体をエラーとする。
  const invalidStoragePath = photoRows.some(
    (row) => typeof row.storage_path !== 'string' || row.storage_path.trim().length === 0,
  )
  if (invalidStoragePath) {
    res.status(409).json({ error: '同期が完了していない写真が含まれています' })
    return
  }

  const photosByPath = new Map<string, string>() // storage_path -> photo id
  for (const row of photoRows) {
    photosByPath.set(row.storage_path as string, row.id as string)
  }
  const allPaths = Array.from(photosByPath.keys())

  const supabaseAdmin = createSupabaseAdminClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const signedResults: { id: string; imageUrl: string }[] = []

  for (let offset = 0; offset < allPaths.length; offset += SIGNED_URL_BATCH_SIZE) {
    const batchPaths = allPaths.slice(offset, offset + SIGNED_URL_BATCH_SIZE)

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from('photo-compressed')
      .createSignedUrls(batchPaths, SIGNED_URL_TTL_SECONDS)

    // バッチ呼び出し自体が失敗した場合。signed URLの中身はログに出さない。
    if (signedError) {
      console.error('[create-genbafoto-job] createSignedUrls batch failed:', signedError.message)
      res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' })
      return
    }

    if (!signedData) {
      console.error('[create-genbafoto-job] createSignedUrls returned no data')
      res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' })
      return
    }

    // 呼び出し自体は成功しても、バッチ内の個別ファイルでエラーが返ることがある
    // （例：対象オブジェクトが実際にはStorageに存在しない）。1件でもエラーがあれば
    // 部分成功にはせず全体を拒否する。
    for (const item of signedData) {
      if (item.error || !item.signedUrl) {
        console.error('[create-genbafoto-job] createSignedUrls returned per-item error in batch')
        res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' })
        return
      }

      const photoId = photosByPath.get(item.path ?? '')
      if (!photoId) {
        // 通常は発生しない（発行時に渡したpathがそのまま返るはず）が、万一整合が取れない
        // 場合は安全側に倒して全体を拒否する。
        console.error('[create-genbafoto-job] signed URL path did not match requested path')
        res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' })
        return
      }
      signedResults.push({ id: photoId, imageUrl: item.signedUrl })
    }
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()

  res.status(200).json({
    expiresAt,
    photos: signedResults,
  })
}

// テストから参照できるよう、リクエストボディの検証ロジックのみ個別にエクスポートする
// （Vercel Functionのハンドラ自体は実際のHTTPリクエストを模擬しないと呼べないため）。
export { parseRequestBody, MAX_PHOTO_IDS, SIGNED_URL_BATCH_SIZE }
export type { RequestBody }
