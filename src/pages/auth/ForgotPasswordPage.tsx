import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { requestPasswordResetEmail } from '@/lib/authRecoveryApi'
import {
  FORGOT_SENT_MESSAGE,
  ForgotPasswordController,
  type ForgotPasswordState,
} from '@/lib/passwordRecoveryControllers'

interface ViewProps {
  state: ForgotPasswordState
  onEmailChange: (email: string) => void
  onSubmit: () => void
  onBackToForm: () => void
}

/** 表示だけの部分（状態と操作は ForgotPasswordController が持つ）。 */
export function ForgotPasswordView({ state, onEmailChange, onSubmit, onBackToForm }: ViewProps) {
  const submitting = state.status === 'submitting'

  if (state.status === 'sent') {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <p className="font-medium">再設定のご案内について</p>
          <p role="status" className="text-sm leading-relaxed text-muted-foreground">
            {FORGOT_SENT_MESSAGE}
          </p>
          <p className="text-xs text-muted-foreground">メールのリンクには有効期限があります。早めにお手続きください。</p>
          <button type="button" onClick={onBackToForm} className="text-sm text-muted-foreground underline hover:text-foreground">
            別のメールアドレスで送る
          </button>
        </CardContent>
        <CardFooter className="justify-center">
          <Link to="/auth/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            ログイン画面に戻る
          </Link>
        </CardFooter>
      </Card>
    )
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-1 text-base font-semibold">パスワードを再設定</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          登録したメールアドレスを入力してください。パスワード再設定のご案内を送ります。
        </p>
        {state.errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.errorMessage}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">メールアドレス</Label>
            <Input
              id="forgot-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={state.email}
              disabled={submitting}
              aria-invalid={state.fieldError ? true : undefined}
              aria-describedby={state.fieldError ? 'forgot-email-error' : undefined}
              onChange={(e) => onEmailChange(e.target.value)}
            />
            {state.fieldError && (
              <p id="forgot-email-error" className="text-sm font-medium text-destructive">
                {state.fieldError}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '送信中...' : '再設定のご案内を送る'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link to="/auth/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ログイン画面に戻る
        </Link>
      </CardFooter>
    </Card>
  )
}

export function ForgotPasswordPage() {
  const [controller] = useState(() => new ForgotPasswordController({ requestReset: requestPasswordResetEmail }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)

  return (
    <ForgotPasswordView
      state={state}
      onEmailChange={controller.setEmail}
      onSubmit={() => void controller.submit()}
      onBackToForm={controller.backToForm}
    />
  )
}
