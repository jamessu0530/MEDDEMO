import { useState, type FormEvent } from "react"
import { Loader2, LogOut } from "lucide-react"

import { changePassword, signOutSession } from "@/api/auth"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, useAuth } from "@/lib/auth"

const ROLE_LABEL = { sales: "業務", manager: "主管" } as const
// 後端要求至少 8 碼；這裡先擋一次，免得為了太短的密碼白跑一趟伺服器
const MIN_LENGTH = 8

/** 帳號設定：看自己的身分、改密碼、登出。業務從今日路線標頭的姓名進來，主管從主管端標頭進來 */
export function SettingsPage() {
  const session = useAuth()
  const user = session?.user
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!user) return null // 沒登入進不來（App.tsx 會導去登入頁），這行只是讓型別成立

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setDone(false)
    if (next.length < MIN_LENGTH) {
      setError(`新密碼至少要 ${MIN_LENGTH} 碼。`)
      return
    }
    if (next !== confirm) {
      setError("兩次輸入的新密碼不一樣，請再確認一次。")
      return
    }
    setBusy(true)
    try {
      // 後端改完密碼會把舊 token 作廢，順手發一張新的：換掉本機存的，這支手機就不必重新登入
      signIn(await changePassword(current, next))
      setCurrent("")
      setNext("")
      setConfirm("")
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "改密碼沒有成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="帳號設定" backTo={user.role === "manager" ? "/manager" : "/"} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        <section className="rounded-2xl border bg-card p-4">
          <p className="text-base font-medium">{user.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.region} · {ROLE_LABEL[user.role]}
          </p>
          <p className="mt-0.5 text-sm break-all text-muted-foreground">{user.email}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">改密碼</h2>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">目前的密碼</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className="h-12 px-3 text-base"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">新密碼</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(event) => setNext(event.target.value)}
                className="h-12 px-3 text-base"
              />
              <p className="text-xs text-muted-foreground">至少 {MIN_LENGTH} 碼。</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">再輸入一次新密碼</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="h-12 px-3 text-base"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
                {error}
              </p>
            )}
            {done && (
              <p role="status" className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-primary">
                密碼已更新。這支手機可以繼續用，其他裝置上的登入已經失效，下次請用新的密碼。
              </p>
            )}

            <Button type="submit" className="h-12 w-full text-base" disabled={busy || !current || !next || !confirm}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : "更新密碼"}
            </Button>
          </form>
        </section>

        <Button variant="outline" className="h-12 w-full gap-2 text-base" onClick={() => void signOutSession()}>
          <LogOut className="size-5" />
          登出
        </Button>
      </main>
    </div>
  )
}
