import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_lib/requireEnv.js'
import { createSupabaseAdminClient } from './_lib/supabaseAdmin.js'
import { isValidUuid } from './_lib/isValidUuid.js'
import { validatePhotoAccess } from './_lib/photoAccess.js'

// Excel高互換出力（.genbafoto / C# Helper連携）用に、対象写真のSigned URLを発行するAPI。
//
// 責務はここまで：photoIdの所有権確認とSigned URL発行のみ。
// templateType・現場情報・.genbafotoそのものの組み立てはクライアント側（Web）の責務であり、
// ここには一切渡さない（渡す必要がない情報をサーバーに送らない、という方針）。
//
// 全体の流れ：
//   Authorization: Bearer <access_token> 必須
//   → supabase.auth.getUser で本人確認（クライアント申告のuserIdは一切信用しない）
//   → JWT付きクライアントで photos と、その工事案件（projects）を select（RLSにより本人所有分だけが返る）
//   → validatePhotoAccess（_lib/photoAccess.ts）で、署名の「前」に認可を確認する：
//        - 要求数と取得数が完全一致しない場合は「部分成功」させず全体エラー（403）
//        - 写真・工事案件が本人のものであること、工事案件が削除済みでないこと（403）
//        - storage_pathが1件でもnull/空ならCloud同期未完了とみなし全体エラー（409）
//        - storage_path が `${認証済みユーザーID}/${写真ID}.jpg` と完全一致しなければ全体エラー（403）
//   → すべて通った場合だけ、service_roleクライアントで photo-compressed から signed URL を100件バッチで発行
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
  const userId = userData.user.id

  const { data: photoRows, error: photoError } = await supabase
    .from('photos')
    .select('id, user_id, project_id, storage_path')
    .in('id', photoIds)

  if (photoError) {
    console.error('[create-genbafoto-job] photos fetch failed:', photoError)
    res.status(500).json({ error: '写真情報の取得に失敗しました' })
    return
  }

  // 写真が属する工事案件も、同じくRLS付きクライアントで取得する（本人の工事案件だけが返る）。
  // photos の RLS は user_id だけを見るため、他人の project_id を指す写真行を作られていても、
  // ここで本人の工事案件として取得できなければ拒否される。
  const projectIds = Array.from(
    new Set((photoRows ?? []).map((row) => row.project_id).filter((id): id is string => typeof id === 'string')),
  )
  let projectRows: unknown[] = []
  if (projectIds.length > 0) {
    const { data, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id, deleted_at')
      .in('id', projectIds)
    if (projectError) {
      console.error('[create-genbafoto-job] projects fetch failed:', projectError)
      res.status(500).json({ error: '写真情報の取得に失敗しました' })
      return
    }
    projectRows = data ?? []
  }

  // 署名付きURLを発行する前の認可（写真・工事案件の所有、削除済みでないこと、storage_pathの完全一致、同期済み）。
  // 1つでも満たさなければ、部分成功にはせず全体を拒否する。応答には他ユーザーの情報・パス・URLを含めない。
  const access = validatePhotoAccess({
    userId,
    requestedPhotoIds: photoIds,
    photoRows: photoRows ?? null,
    projectRows,
  })
  if (!access.ok) {
    // 原因の分類だけをログに残す（storage_path・写真ID・署名付きURLは出さない）。
    console.error('[create-genbafoto-job] access denied:', access.reason)
    res.status(access.status).json({ error: access.error })
    return
  }

  const photosByPath = new Map<string, string>() // storage_path -> photo id
  for (const photo of access.photos) {
    photosByPath.set(photo.storagePath, photo.id)
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
