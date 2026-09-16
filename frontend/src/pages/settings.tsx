import { useEffect, useState, type FormEvent } from "react"
import { Loader2, LogOut } from "lucide-react"
import { useLocation, useNavigate } from "react-router"

import {
  changePassword,
  linkProvider,
  signOutSession,
  unlinkProvider,
  type OAuthCredential,
  type OAuthProviders,
} from "@/api/auth"
import { FacebookButton, GitHubButton, GoogleButton } from "@/components/oauth-buttons"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { refreshUser, signIn, useAuth, type AuthUser } from "@/lib/auth"
import { PROVIDER_LABEL, useProviders, type OAuthProvider } from "@/lib/oauth"

const ROLE_LABEL = { sales: "業務", manager: "主管" } as const
// 後端要求至少 8 碼；這裡先擋一次，免得為了太短的密碼白跑一趟伺服器
const MIN_LENGTH = 8

const PROVIDERS: OAuthProvider[] = ["google", "github", "facebook"]

/**
 * 綁定的登入方式：帳號是公司給的，第三方帳號不會自動開帳號，要在這裡綁到自己身上，之後登入頁才能用。
 * 伺服器沒設定的那一家不列；一家都沒設定（或問不到）整區不出現。
 */
function LinkedAccounts({ user, providers }: { user: AuthUser; providers: OAuthProviders }) {
  const location = useLocation()
  const navigate = useNavigate()
  // GitHub 綁定是整頁導走再回來，callback 頁用 location.state 告訴這裡成功了
  const [done, setDone] = useState<string | null>(() => {
    const linked = (location.state as { linked?: OAuthProvider } | null)?.linked
    return linked ? `已綁定 ${PROVIDER_LABEL[linked]}，下次在登入頁可以直接用它登入。` : null
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<OAuthProvider | null>(null)
  // 對話框關閉時有淡出動畫，provider 留著不清，標題才不會在淡出途中變成空白
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState<OAuthProvider>("google")

  // 訊息已經拿到了，把 location.state 清掉，重新整理這一頁才不會又顯示一次
  useEffect(() => {
    if ((location.state as { linked?: string } | null)?.linked) navigate(".", { replace: true, state: null })
  }, [location.state, navigate])

  const configured = PROVIDERS.filter((provider) => providers[provider])
  if (configured.length === 0) return null

  async function link(credential: OAuthCredential) {
    if (busy) return
    setBusy(credential.provider)
    setError(null)
    setDone(null)
    try {
      refreshUser(await linkProvider(credential))
      setDone(`已綁定 ${PROVIDER_LABEL[credential.provider]}，下次在登入頁可以直接用它登入。`)
    } catch (err) {
      // 409 是這個第三方帳號已經綁在別人身上，後端的訊息直接顯示
      setError(err instanceof Error ? err.message : "綁定沒有成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  async function unlink(provider: OAuthProvider) {
    setConfirmOpen(false)
    if (busy) return
    setBusy(provider)
    setError(null)
    setDone(null)
    try {
      refreshUser(await unlinkProvider(provider))
      setDone(`已解除 ${PROVIDER_LABEL[provider]} 綁定。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除綁定沒有成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  function showError(message: string) {
    setDone(null)
    setError(message)
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">綁定的登入方式</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          綁定之後，登入頁可以直接用這些帳號登入；Email 密碼一樣可以用。
        </p>
      </div>

      <ul className="divide-y rounded-2xl border bg-card">
        {configured.map((provider) => {
          const linked = user.linked?.find((account) => account.provider === provider)
          const label = PROVIDER_LABEL[provider]
          // 這支手機存的舊身分還沒有 linked 欄位：等 /api/auth/me 回來再給按鈕，免得把已綁定的顯示成未綁定
          const loading = user.linked === undefined
          let status = "尚未綁定"
          if (loading) status = "讀取中…"
          else if (linked) status = linked.email ?? "已綁定"

          let action = null
          if (loading) action = null
          else if (busy === provider) action = <Loader2 className="size-5 animate-spin text-muted-foreground" />
          else if (linked)
            action = (
              <Button
                variant="outline"
                className="h-11 px-4"
                disabled={busy !== null}
                onClick={() => {
                  setConfirming(provider)
                  setConfirmOpen(true)
                }}
              >
                解除綁定
              </Button>
            )
          else if (provider === "google" && providers.google)
            action = (
              <div className="w-full">
                <GoogleButton
                  clientId={providers.google.client_id}
                  text="continue_with"
                  onCredential={(credential) => void link({ provider: "google", body: { credential } })}
                />
              </div>
            )
          else if (provider === "github" && providers.github)
            action = (
              <GitHubButton
                clientId={providers.github.client_id}
                mode="link"
                label="綁定"
                className="h-11 px-4"
                disabled={busy !== null}
                onError={showError}
              />
            )
          else if (provider === "facebook" && providers.facebook)
            action = (
              <FacebookButton
                appId={providers.facebook.app_id}
                label="綁定"
                variant="outline"
                className="h-11 px-4"
                disabled={busy !== null}
                onToken={(token) => void link({ provider: "facebook", body: { access_token: token } })}
                onError={showError}
              />
            )

          return (
            <li key={provider} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-0.5 text-xs break-all text-muted-foreground">{status}</p>
              </div>
              {action}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-primary">
          {done}
        </p>
      )}

      {/* 解除前確認：按錯的話要重新走一次第三方授權才綁得回來 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>解除 {PROVIDER_LABEL[confirming]} 綁定？</DialogTitle>
            <DialogDescription>
              解除後就不能再用這個 {PROVIDER_LABEL[confirming]} 帳號登入，Email 密碼登入不受影響；之後想用可以再綁定一次。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" className="h-11" onClick={() => void unlink(confirming)}>
              解除綁定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** 帳號設定：看自己的身分、綁定第三方登入、改密碼、登出。業務從今日路線標頭的姓名進來，主管從主管端標頭進來 */
export function SettingsPage() {
  const session = useAuth()
  const user = session?.user
  const providers = useProviders()
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
          {user.email && <p className="mt-0.5 text-sm break-all text-muted-foreground">{user.email}</p>}
          {user.acting_as && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              這是用第三方登入開的帳號，自己名下沒有客戶，今日路線與客戶看的是示範業務{user.acting_as.name}的資料。
            </p>
          )}
        </section>

        {providers && <LinkedAccounts user={user} providers={providers} />}

        {user.has_password === false ? (
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">密碼</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">這個帳號用第三方登入，沒有密碼。</p>
          </section>
        ) : (
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
        )}

        <Button variant="outline" className="h-12 w-full gap-2 text-base" onClick={() => void signOutSession()}>
          <LogOut className="size-5" />
          登出
        </Button>
      </main>
    </div>
  )
}
