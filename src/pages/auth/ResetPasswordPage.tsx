import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { initialAuthUrlState, recoveryState } from '@/lib/passwordRecovery'
import { signOutRecoveredSession, updateRecoveredPassword } from '@/lib/authRecoveryApi'
import { ResetPasswordController, type ResetPasswordState } from '@/lib/passwordRecoveryControllers'

/** 再設定リンクから戻った直後、PASSWORD_RECOVERY の通知を待つ最長時間 */
const RECOVERY_WAIT_MS = 4000

interface ViewProps {
  state: ResetPasswordState
  onPasswordChange: (value: string) => void
  onConfirmChange: (value: string) => void
  onSubmit: () => void
}

function BackLinks({ resend }: { resend?: boolean }) {
  return (
    <CardFooter className="flex flex-col gap-2 text-sm">
      {resend && (
        <Link to="/auth/forgot-password" className="font-medium underline">
          もう一度、再設定のご案内を送る
        </Link>
      )}
      <Link to="/auth/login" className="text-muted-foreground hover:text-foreground hover:underline">
        ログイン画面に戻る
      </Link>
    </CardFooter>
  )
}

/** 表示だけの部分（状態と操作は ResetPasswordController が持つ）。 */
export function ResetPasswordView({ state, onPasswordChange, onConfirmChange, onSubmit }: ViewProps) {
  const { phase } = state

  if (phase === 'checking') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p role="status" className="text-sm text-muted-foreground">
            再設定のリンクを確認しています…
          </p>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'done') {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p role="status" className="font-medium">
            パスワードを変更しました
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">新しいパスワードでログインしてください。</p>
          <Button asChild className="w-full">
            <Link to="/auth/login">ログイン画面へ</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'expired' || phase === 'invalid') {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6 text-center">
          <p className="font-medium">
            {phase === 'expired' ? '再設定のリンクの有効期限が切れています' : '再設定のリンクを確認できませんでした'}
          </p>
          <p role="alert" className="text-sm leading-relaxed text-muted-foreground">
            {phase === 'expired'
              ? 'リンクは、一定時間が過ぎたり、一度使ったりすると無効になります。お手数ですが、もう一度、再設定のご案内を送ってください。'
              : 'メールのリンクから開き直してください。リンクが古い場合は、もう一度、再設定のご案内を送ってください。'}
          </p>
        </CardContent>
        <BackLinks resend />
      </Card>
    )
  }

  const submitting = phase === 'submitting'
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-1 text-base font-semibold">新しいパスワードを設定</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">8文字以上で入力してください。</p>
        {state.errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.errorMessage}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reset-password">新しいパスワード</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              placeholder="8文字以上"
              value={state.password}
              disabled={submitting}
              aria-invalid={state.passwordError ? true : undefined}
              onChange={(e) => onPasswordChange(e.target.value)}
            />
            {state.passwordError && <p className="text-sm font-medium text-destructive">{state.passwordError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">新しいパスワード（確認）</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="もう一度入力"
              value={state.confirm}
              disabled={submitting}
              aria-invalid={state.confirmError ? true : undefined}
              onChange={(e) => onConfirmChange(e.target.value)}
            />
            {state.confirmError && <p className="text-sm font-medium text-destructive">{state.confirmError}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '変更中...' : 'パスワードを変更'}
          </Button>
        </form>
      </CardContent>
      <BackLinks />
    </Card>
  )
}

export function ResetPasswordPage() {
  const [controller] = useState(
    () =>
      new ResetPasswordController({
        recovery: recoveryState,
        urlError: initialAuthUrlState.error,
        mayBeRecovery: initialAuthUrlState.mayBeRecovery,
        updatePassword: updateRecoveredPassword,
        signOutRecoveredSession,
      }),
  )
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)

  // PASSWORD_RECOVERY の到着を監視し、一定時間待っても来なければ「再設定リンクではない」と判断する
  useEffect(() => {
    const stop = controller.start()
    const timer = window.setTimeout(controller.waitTimeout, RECOVERY_WAIT_MS)
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [controller])

  return (
    <ResetPasswordView
      state={state}
      onPasswordChange={controller.setPassword}
      onConfirmChange={controller.setConfirm}
      onSubmit={() => void controller.submit()}
    />
  )
}
