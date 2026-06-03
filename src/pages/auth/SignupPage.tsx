import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'

const signupSchema = z.object({
  displayName: z
    .string()
    .min(1, 'お名前を入力してください')
    .max(50, '50文字以内で入力してください'),
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

type SignupValues = z.infer<typeof signupSchema>

export function SignupPage() {
  const navigate = useNavigate()
  const { signUp, isConfigured } = useAuth()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  })

  const onSubmit = async (values: SignupValues) => {
    setErrorMessage(null)
    const { error } = await signUp(values.email, values.password, values.displayName)
    if (error) {
      setErrorMessage('アカウントの作成に失敗しました。もう一度お試しください。')
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
            <AlertDescription>{errorMessage}</AlertDescription>
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
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
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
