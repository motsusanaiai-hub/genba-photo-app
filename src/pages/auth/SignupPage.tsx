import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { AuthError } from '@supabase/supabase-js'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { signupSchema, type SignupValues } from '@/lib/signupSchema'

/** Supabaseのエラーコードに応じて、原因が分かるメッセージに変換する */
function getSignupErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'over_email_send_rate_limit':
      return '確認メール送信回数の上限に達しました。\nしばらく時間を空けて再度お試しください。'
    case 'user_already_exists':
    case 'email_exists':
      return 'このメールアドレスは既に登録されています。\nログイン画面からログインしてください。'
    case 'weak_password':
      return 'パスワードの強度が不十分です。別のパスワードをお試しください。'
    case 'email_address_invalid':
      return 'このメールアドレスは登録できません。別のメールアドレスをお試しください。'
    case 'signup_disabled':
      return '現在、新規登録を受け付けていません。'
    case 'over_request_rate_limit':
      return 'リクエストが多すぎます。しばらく時間を空けて再度お試しください。'
    default:
      // statusが無いエラーはレスポンス受信前の失敗（通信断など）
      if (error.status === undefined) {
        return '通信エラーが発生しました。ネットワーク接続を確認してもう一度お試しください。'
      }
      return 'アカウントの作成に失敗しました。もう一度お試しください。'
  }
}

export function SignupPage() {
  const navigate = useNavigate()
  const { signUp, isConfigured } = useAuth()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: '', email: '', password: '', consent: false },
  })

  const consent = form.watch('consent')

  const onSubmit = async (values: SignupValues) => {
    setErrorMessage(null)
    const { error } = await signUp(values.email, values.password, values.displayName)
    if (error) {
      setErrorMessage(getSignupErrorMessage(error))
    } else if (!isConfigured) {
      navigate('/')
    } else {
      setEmailSent(true)
    }
  }

  if (emailSent) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-3">
          <p className="font-medium">確認メールを送信しました</p>
          <p className="text-sm text-muted-foreground">
            登録いただいたメールアドレスに確認リンクを送信しました。
            メールを確認してアカウントを有効化してください。
          </p>
          <Link to="/auth/login" className="text-sm text-muted-foreground hover:underline block">
            ログイン画面に戻る
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription className="whitespace-pre-line">{errorMessage}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>お名前（表示名）</FormLabel>
                  <FormControl>
                    <Input placeholder="山田 太郎" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>メールアドレス</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>パスワード</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="8文字以上" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="consent"
              render={({ field }) => (
                <FormItem>
                  {/* 規約ページは別タブで開く（入力中のフォームを失わないため）。同意しないと登録できない。 */}
                  <label className="flex cursor-pointer items-start gap-3 py-1 text-sm leading-relaxed">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary"
                      />
                    </FormControl>
                    <span>
                      <Link to="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                        利用規約
                      </Link>
                      と
                      <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                        プライバシーポリシー
                      </Link>
                      を確認し、同意します
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground">現場フォトは無料でご利用いただけます（画面に広告が表示されます）。</p>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || !consent}>
              {form.formState.isSubmitting ? '作成中...' : 'アカウントを作成'}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link to="/auth/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          すでにアカウントをお持ちの方 ›
        </Link>
      </CardFooter>
    </Card>
  )
}
