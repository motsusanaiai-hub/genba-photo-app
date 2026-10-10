/**
 * Stripe から戻す先（success_url / cancel_url / return_url）に使うOriginを決める純粋関数。
 *
 * Origin / Host ヘッダーはクライアントが任意に送れるため、そのままURLに使わない
 * （他人を経由した Stripe Checkout / Portal → 任意ドメインへのリダイレクトに悪用され得る）。
 * Vercelのシステム環境変数（スキーム無しのホスト名）を許可リストとし、
 * リクエストのOriginが許可リストに含まれる場合だけそれを使う
 * （ログイン中のブラウザと同じOriginへ戻すため。Supabaseのセッションは
 *   Origin単位でlocalStorageに保存されている）。含まれない場合は環境ごとの正規URLへ戻す。
 * 決められない場合は null（呼び出し側で fail closed）。
 *
 * Production は例外で、リクエストの Origin・VERCEL_URL・VERCEL_PROJECT_PRODUCTION_URL に関係なく
 * 常に PRODUCTION_APP_ORIGIN を返す（Vercel のシステム環境変数の有無に左右されないようにするため）。
 * 独自ドメインへ移行する場合は、この定数を変更して再デプロイする。
 */
export const PRODUCTION_APP_ORIGIN = 'https://genba-photo-app.vercel.app'

export function resolveAppOrigin(input: {
  vercelEnv: string | undefined
  vercelUrl: string | undefined
  vercelBranchUrl: string | undefined
  /** Production では使わない（PRODUCTION_APP_ORIGIN に固定）。呼び出し側の互換のため残している。 */
  vercelProductionUrl: string | undefined
  requestOrigin: string | undefined
}): string | null {
  const { vercelEnv, vercelUrl, vercelBranchUrl, requestOrigin } = input

  if (vercelEnv === 'production') return PRODUCTION_APP_ORIGIN

  let requested: URL | null = null
  if (requestOrigin) {
    try {
      requested = new URL(requestOrigin)
    } catch {
      requested = null
    }
  }

  if (vercelEnv === 'preview') {
    const canonical = vercelBranchUrl ?? vercelUrl
    const allowedHosts = [canonical, vercelUrl].filter((host): host is string => !!host)
    if (requested && requested.protocol === 'https:' && allowedHosts.includes(requested.host)) {
      return requested.origin
    }
    return canonical ? `https://${canonical}` : null
  }

  // ローカル開発（vercel dev 等）。localhost / 127.0.0.1 のOriginだけ許可する。
  if (
    requested &&
    (requested.protocol === 'http:' || requested.protocol === 'https:') &&
    (requested.hostname === 'localhost' || requested.hostname === '127.0.0.1')
  ) {
    return requested.origin
  }
  return null
}
