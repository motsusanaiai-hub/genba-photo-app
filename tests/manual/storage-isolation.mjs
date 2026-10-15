// ============================================================================
// Storage PRIVATE 化後のユーザー間アクセス拒否テスト（手動実行・staging 専用）
// ============================================================================
// 目的：ユーザーAの写真を、ユーザーBが Storage から取得できないことを、実際の Supabase で確認する。
//
// これは自動テスト（npm run test / Vitest）には含まれない。tests/manual/ に置き、手動で実行する。
// 実行方法は tests/manual/README.md を参照。
//
// 安全対策（このスクリプトがやらないこと）：
//   - staging 以外には接続しない（接続前に URL のホスト名を完全一致で確認。本番の Project ref を含む入力は停止）
//   - service_role キーは使わない（anon キーだけ。role=service_role のキーは接続前に停止）
//   - データの登録・更新・削除はしない（SELECT・download・署名URLの発行だけ）
//   - パスワード・JWT・署名URL・Storageパス・ユーザーID・メールアドレスを画面にもファイルにも出さない
//   - パスワードは環境変数・引数・ファイルで受け取らず、実行時に（表示せずに）入力する
//   - ブラウザの保存データ（IndexedDB・localStorage）には触れない
//   - 終了時にサインアウトする（このスクリプトの端末内の状態だけを消す。他の端末のログインは切らない）
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'

// ─── 固定値（staging のみ） ─────────────────────────────────────────────
export const STAGING_REF = 'jhlyudtuawukojymylmr'
export const STAGING_HOST = `${STAGING_REF}.supabase.co`
export const PRODUCTION_REF = 'vrhvwlhdbbgocoqkfahq'
const SUPABASE_URL = `https://${STAGING_HOST}`
const BUCKET = 'photo-compressed'

// ─── 安全確認（接続前に必ず通す） ─────────────────────────────────────────

/** URL が staging のホスト名と完全一致していること。本番の ref を含む文字列は常に拒否する。 */
export function assertStagingUrl(urlString) {
  if (typeof urlString !== 'string' || urlString.includes(PRODUCTION_REF)) {
    throw new Error('本番の Project ref を含む接続先は使えません')
  }
  let url
  try {
    url = new URL(urlString)
  } catch {
    throw new Error('接続先 URL が不正です')
  }
  if (url.protocol !== 'https:' || url.hostname !== STAGING_HOST || url.port !== '') {
    throw new Error('接続先が staging のホスト名と一致しません')
  }
}

/** JWT 形式のキーの payload を読む（署名は検証しない。値は表示しない）。JWT でなければ null。 */
export function decodeJwtPayload(key) {
  if (typeof key !== 'string') return null
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const payload = JSON.parse(json)
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** anon キーだけを許可する。service_role・本番の ref・staging 以外の ref のキーは拒否する。 */
export function assertAnonKey(key) {
  if (typeof key !== 'string' || key.trim().length < 20) throw new Error('anon キーが入力されていません')
  if (key.includes(PRODUCTION_REF)) throw new Error('本番用のキーは使えません')
  if (/^sb_secret_/.test(key)) throw new Error('secret キーは使えません（anon / publishable キーのみ）')
  const payload = decodeJwtPayload(key)
  if (payload) {
    if (payload.role !== 'anon') throw new Error('anon 以外のキーは使えません')
    if (typeof payload.ref === 'string' && payload.ref !== STAGING_REF) {
      throw new Error('staging 以外のプロジェクトのキーは使えません')
    }
  } else if (!/^sb_publishable_/.test(key)) {
    throw new Error('anon キーの形式を判別できません')
  }
}

// ─── 結果の分類 ─────────────────────────────────────────────────────────
const DENIED_STATUSES = new Set([400, 401, 403, 404])

function statusOf(error) {
  if (!error) return undefined
  const raw = error.status ?? error.statusCode
  const n = typeof raw === 'string' ? Number(raw) : raw
  return Number.isInteger(n) ? n : undefined
}

function isNetworkError(error) {
  if (!error) return false
  const original = error.originalError ?? error.cause
  if (original instanceof TypeError) return true
  if (error instanceof TypeError) return true
  return /fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|timeout/i.test(String(error.message ?? ''))
}

/**
 * アクセス拒否が期待される操作の結果を分類する。
 *   成功応答（データを取得できた）          → 'fail'（セキュリティ上の問題）
 *   拒否のステータス（400/401/403/404）      → 'pass'
 *   ネットワーク障害・5xx・不明なエラー等    → 'inconclusive'（拒否成功とは判断しない）
 */
export function classifyDenied({ gotData, error }) {
  if (gotData) return 'fail'
  if (!error) return 'inconclusive'
  if (isNetworkError(error)) return 'inconclusive'
  const status = statusOf(error)
  if (status !== undefined && DENIED_STATUSES.has(status)) return 'pass'
  return 'inconclusive'
}

/** アクセス成功が期待される操作の結果を分類する。 */
export function classifyAllowed({ gotData, error }) {
  if (gotData && !error) return 'pass'
  if (error && isNetworkError(error)) return 'inconclusive'
  return 'fail'
}

export function overallResult(r) {
  const security = [r.bDownload, r.bSigned, r.publicUrl]
  if (security.includes('fail')) return 'FAIL'
  const all = [r.aDownload, r.aSigned, ...security]
  if (all.includes('inconclusive') || all.includes('fail')) return 'INCONCLUSIVE' // 本人のアクセスが失敗＝対照が成立しない
  return 'PASS'
}

const LABEL = { pass: 'PASS', fail: 'FAIL', inconclusive: 'INCONCLUSIVE' }

// ─── 入力（パスワードは表示せずに受け取る） ─────────────────────────────────

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('対話できる端末（PowerShell など）で実行してください'))
      return
    }
    process.stdout.write(question)
    let value = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const finish = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish()
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          finish()
          reject(new Error('中断しました'))
          return
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

// ─── テスト本体 ─────────────────────────────────────────────────────────

function newClient(anonKey) {
  // セッションは保存しない（ディスクにも残さない）
  return createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data?.user) return null
  return data.user.id
}

async function run() {
  assertStagingUrl(SUPABASE_URL)

  console.log('Storage 隔離テスト（staging 専用・読み取りのみ）')
  console.log('接続先: staging（' + STAGING_HOST + '）')
  console.log('入力した内容は画面にもファイルにも保存しません。\n')

  const anonKey = await promptHidden('staging の anon キー（入力は表示されません）: ')
  assertAnonKey(anonKey)
  const emailA = await promptLine('ユーザーA（テスト用）のメールアドレス: ')
  const passA = await promptHidden('ユーザーA のパスワード（表示されません）: ')
  const emailB = await promptLine('ユーザーB（テスト用）のメールアドレス: ')
  const passB = await promptHidden('ユーザーB のパスワード（表示されません）: ')
  console.log('')

  const result = { aDownload: 'inconclusive', aSigned: 'inconclusive', bDownload: 'inconclusive', bSigned: 'inconclusive', publicUrl: 'inconclusive' }
  const notes = []
  const clientA = newClient(anonKey)
  const clientB = newClient(anonKey)

  try {
    // ── A でログインし、自分の写真を 1 件取得 ──
    const idA = await signIn(clientA, emailA, passA)
    if (!idA) {
      notes.push('ユーザーAのログインに失敗しました（メールアドレス・パスワード・接続を確認してください）')
      return { result, notes }
    }
    const { data: rows, error: rowsError } = await clientA
      .from('photos')
      .select('storage_path')
      .not('storage_path', 'is', null)
      .limit(1)
    if (rowsError || !rows || rows.length === 0 || typeof rows[0].storage_path !== 'string') {
      notes.push('ユーザーAの写真（クラウド同期済み）を取得できませんでした。Aでテスト用の写真を同期してから再実行してください')
      return { result, notes }
    }
    const path = rows[0].storage_path
    if (!path.startsWith(idA + '/')) {
      notes.push('取得した写真の保存先がAの所有者フォルダではないため、テストを中止しました')
      return { result, notes }
    }

    // ── TEST 1：A 本人のアクセス ──
    {
      const { data, error } = await clientA.storage.from(BUCKET).download(path)
      result.aDownload = classifyAllowed({ gotData: !!data && data.size > 0, error })
    }
    {
      const { data, error } = await clientA.storage.from(BUCKET).createSignedUrl(path, 60)
      result.aSigned = classifyAllowed({ gotData: !!data?.signedUrl, error })
    }

    // ── B でログイン ──
    const idB = await signIn(clientB, emailB, passB)
    if (!idB) {
      notes.push('ユーザーBのログインに失敗しました（メールアドレス・パスワード・接続を確認してください）')
      return { result, notes }
    }
    if (idB === idA) {
      notes.push('AとBが同じアカウントです。別々のテスト用アカウントを入力してください')
      return { result, notes }
    }

    // ── TEST 2：B による A の写真へのアクセス（拒否が期待結果） ──
    {
      const { data, error } = await clientB.storage.from(BUCKET).download(path)
      result.bDownload = classifyDenied({ gotData: !!data && data.size > 0, error })
    }
    {
      const { data, error } = await clientB.storage.from(BUCKET).createSignedUrl(path, 60)
      result.bSigned = classifyDenied({ gotData: !!data?.signedUrl, error })
    }

    // ── TEST 3：認証なしの公開 URL（拒否が期待結果）。発行済みの署名URLは使わない ──
    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`, { method: 'GET' })
      const status = response.status
      await response.body?.cancel()
      if (status === 200) result.publicUrl = 'fail'
      else if (DENIED_STATUSES.has(status)) result.publicUrl = 'pass'
      else result.publicUrl = 'inconclusive'
    } catch {
      result.publicUrl = 'inconclusive'
    }
    return { result, notes }
  } finally {
    // この端末内の状態だけを消す（scope: local）。サーバー側の他のログインは切らない
    await Promise.allSettled([clientA.auth.signOut({ scope: 'local' }), clientB.auth.signOut({ scope: 'local' })])
  }
}

function printReport({ result, notes }) {
  console.log('TEST 1')
  console.log('  A本人のdownload：' + LABEL[result.aDownload])
  console.log('  A本人の署名URL発行：' + LABEL[result.aSigned])
  console.log('TEST 2')
  console.log('  Bによるdownload：' + LABEL[result.bDownload])
  console.log('  Bによる署名URL発行：' + LABEL[result.bSigned])
  console.log('TEST 3')
  console.log('  公開URLへのアクセス：' + LABEL[result.publicUrl])
  const overall = overallResult(result)
  console.log('\n総合判定：' + overall)
  for (const note of notes) console.log('注意：' + note)
  if (overall === 'FAIL') console.log('他人の写真を取得できた、または公開URLで取得できた項目があります。結果をClaudeに伝えてください（キーやパスワードは伝えないでください）。')
  if (overall === 'INCONCLUSIVE') console.log('判定できませんでした（ログイン失敗・写真なし・通信障害など）。アクセス拒否が成功したとは判断していません。')
  return overall
}

// ─── オフライン自己検査（--selftest。ネットワークに接続しない） ─────────────────
function selftest() {
  let failed = 0
  const check = (name, ok) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + name)
    if (!ok) failed++
  }
  const throws = (fn) => {
    try {
      fn()
      return false
    } catch {
      return true
    }
  }
  const jwt = (payload) => 'x.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.y'
  check('staging の URL は通る', !throws(() => assertStagingUrl(`https://${STAGING_HOST}`)))
  check('本番の ref を含む URL は拒否', throws(() => assertStagingUrl(`https://${PRODUCTION_REF}.supabase.co`)))
  check('別ホストは拒否', throws(() => assertStagingUrl('https://example.com')))
  check('ホストに staging を含むだけの URL は拒否', throws(() => assertStagingUrl(`https://${STAGING_HOST}.evil.example`)))
  check('http は拒否', throws(() => assertStagingUrl(`http://${STAGING_HOST}`)))
  check('anon キー（staging）は通る', !throws(() => assertAnonKey(jwt({ role: 'anon', ref: STAGING_REF, pad: 'xxxxxxxxxxxx' }))))
  check('service_role キーは拒否', throws(() => assertAnonKey(jwt({ role: 'service_role', ref: STAGING_REF, pad: 'xxxxxxxxxxxx' }))))
  check('本番の ref の anon キーは拒否', throws(() => assertAnonKey(jwt({ role: 'anon', ref: PRODUCTION_REF, pad: 'xxxxxxxxxxxx' }))))
  check('別プロジェクトの anon キーは拒否', throws(() => assertAnonKey(jwt({ role: 'anon', ref: 'someotherprojectref', pad: 'xxxxxxxxxxxx' }))))
  check('sb_secret_ キーは拒否', throws(() => assertAnonKey('sb_secret_' + 'a'.repeat(30))))
  check('sb_publishable_ キーは通る', !throws(() => assertAnonKey('sb_publishable_' + 'a'.repeat(30))))
  check('空のキーは拒否', throws(() => assertAnonKey('')))
  const err = (status, extra = {}) => ({ status, message: 'x', ...extra })
  check('拒否: データ取得できた → FAIL', classifyDenied({ gotData: true, error: null }) === 'fail')
  check('拒否: 400 → PASS', classifyDenied({ gotData: false, error: err(400) }) === 'pass')
  check('拒否: 404 → PASS', classifyDenied({ gotData: false, error: err(404) }) === 'pass')
  check('拒否: 403 → PASS', classifyDenied({ gotData: false, error: err(403) }) === 'pass')
  check('拒否: 500 → INCONCLUSIVE', classifyDenied({ gotData: false, error: err(500) }) === 'inconclusive')
  check('拒否: ネットワーク障害 → INCONCLUSIVE', classifyDenied({ gotData: false, error: { message: 'fetch failed', originalError: new TypeError('fetch failed') } }) === 'inconclusive')
  check('拒否: ステータス不明のエラー → INCONCLUSIVE', classifyDenied({ gotData: false, error: { message: 'unknown' } }) === 'inconclusive')
  check('許可: 取得できた → PASS', classifyAllowed({ gotData: true, error: null }) === 'pass')
  check('許可: 400 → FAIL', classifyAllowed({ gotData: false, error: err(400) }) === 'fail')
  check('許可: ネットワーク障害 → INCONCLUSIVE', classifyAllowed({ gotData: false, error: { message: 'fetch failed' } }) === 'inconclusive')
  const ok = { aDownload: 'pass', aSigned: 'pass', bDownload: 'pass', bSigned: 'pass', publicUrl: 'pass' }
  check('総合: すべて PASS → PASS', overallResult(ok) === 'PASS')
  check('総合: B が取得できた → FAIL', overallResult({ ...ok, bDownload: 'fail' }) === 'FAIL')
  check('総合: 公開URLで取得できた → FAIL', overallResult({ ...ok, publicUrl: 'fail' }) === 'FAIL')
  check('総合: A 本人が失敗 → INCONCLUSIVE（対照が成立しない）', overallResult({ ...ok, aDownload: 'fail' }) === 'INCONCLUSIVE')
  check('総合: 通信障害が混在 → INCONCLUSIVE', overallResult({ ...ok, bSigned: 'inconclusive' }) === 'INCONCLUSIVE')
  check('総合: 拒否の失敗と他の不明が混在 → FAIL（セキュリティ上の問題を優先）', overallResult({ ...ok, bDownload: 'fail', aSigned: 'inconclusive' }) === 'FAIL')
  console.log(failed === 0 ? '\n自己検査: すべて OK（ネットワークには接続していません）' : `\n自己検査: ${failed} 件 NG`)
  return failed === 0 ? 0 : 1
}

// ─── エントリーポイント ───────────────────────────────────────────────────
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest())
  }
  try {
    const report = await run()
    const overall = printReport(report)
    process.exit(overall === 'PASS' ? 0 : overall === 'FAIL' ? 1 : 2)
  } catch (error) {
    // 認証情報が含まれ得るため、エラーの内容は表示しない（種類と、安全確認の失敗理由のみ）
    const safe = error instanceof Error && /^(本番|接続先|anon|secret|staging|対話|中断)/.test(error.message) ? error.message : null
    console.error('テストを中止しました' + (safe ? '：' + safe : '（予期しないエラー）'))
    process.exit(2)
  }
}
