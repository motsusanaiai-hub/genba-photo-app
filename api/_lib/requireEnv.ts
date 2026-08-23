/**
 * 必須環境変数をまとめて取得する。1つでも未設定なら missing に名前を積んで返すだけで、
 * ここでは例外を投げたり process を落としたりしない
 * （呼び出し側のAPIハンドラが「決済機能が現在利用できません」等の
 *   明確なレスポンスを返せるようにするため）。
 */
export function requireEnv<Names extends string>(
  names: readonly Names[],
): { values: Record<Names, string>; missing: Names[] } {
  const values = {} as Record<Names, string>
  const missing: Names[] = []

  for (const name of names) {
    const value = process.env[name]
    if (!value) {
      missing.push(name)
    } else {
      values[name] = value
    }
  }

  return { values, missing }
}
