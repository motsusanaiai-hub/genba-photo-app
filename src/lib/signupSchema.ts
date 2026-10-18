import { z } from 'zod'

/** 同意チェックが無いときに表示するメッセージ */
export const SIGNUP_CONSENT_MESSAGE = '利用規約とプライバシーポリシーへの同意が必要です'

/** パスワードの入力条件（新規登録とパスワード再設定で共通）。8文字以上。 */
export const passwordSchema = z.string().min(8, 'パスワードは8文字以上で入力してください')

/**
 * 新規登録フォームの入力検証。
 * consent は「利用規約とプライバシーポリシーを確認し、同意します」のチェック。true でなければ登録できない。
 * 同意の内容はサーバーへ送らず、DBにも保存しない（同意履歴の保存は未実装）。
 * ログインには使わない（ログイン時の同意チェックは不要）。
 */
export const signupSchema = z.object({
  displayName: z
    .string()
    .min(1, 'お名前を入力してください')
    .max(50, '50文字以内で入力してください'),
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: passwordSchema,
  consent: z.boolean().refine((value) => value === true, { message: SIGNUP_CONSENT_MESSAGE }),
})

export type SignupValues = z.infer<typeof signupSchema>
