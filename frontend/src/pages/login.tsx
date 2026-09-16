import { useState, type FormEvent } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Navigate, useLocation, useNavigate } from "react-router"

import { login, oauthLogin, type OAuthCredential } from "@/api/auth"
import { FacebookButton, GitHubButton, GoogleButton } from "@/components/oauth-buttons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readSignedOutReason, signIn, useAuth, type Session } from "@/lib/auth"
import { useProviders } from "@/lib/oauth"

/** 登入成功後要去哪一頁：業務是今日路線，主管是主管端 */
function home(role: "sales" | "manager") {
  return role === "manager" ? "/manager" : "/"
}

/**
 * 登入頁（FR-12）：公司給的 Email 加密碼。
 * 錯誤訊息直接顯示後端回的那一句（找不到這個 Email／密碼錯誤），不自己改寫，
 * 免得畫面上說的跟後端判斷的不一樣。
 */
export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providers = useProviders()
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  // 上一次是被系統登出的（登入已過期、帳號已在其他裝置登入），把原因說清楚
  const signedOut = readSignedOutReason()

  // 已經登入了還打開 /login（例如用書籤進來）：直接回自己的首頁
  if (session) return <Navigate to={home(session.user.role)} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setOauthError(null)
    try {
      enter(await login(email.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : "連不上伺服器，請確認網路後再試一次")
      setPassword("")
    } finally {
      setBusy(false)
    }
  }

  // 剛才是被擋下來的那一頁就回去那一頁，否則照身分回首頁
  function enter(result: Session) {
    signIn(result)
    const from = (location.state as { from?: string } | null)?.from
    navigate(from ?? home(result.user.role), { replace: true })
  }

  /**
   * Google／Facebook 拿到憑證之後送去後端換登入。沒綁定過的第三方帳號後端回 401，
   * 訊息會說明要先用 Email 登入再到帳號設定綁定，照原文顯示。GitHub 是整頁導走，結果在 callback 頁處理。
   */
  async function submitOAuth(credential: OAuthCredential) {
    if (oauthBusy) return
    setOauthBusy(true)
    setOauthError(null)
    setError(null)
    try {
      enter(await oauthLogin(credential))
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "連不上伺服器，請確認網路後再試一次")
    } finally {
      setOauthBusy(false)
    }
  }

  const hasOAuth = Boolean(providers?.google || providers?.github || providers?.facebook)

  return (
    <div className="flex min-h-svh flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <p className="text-xs text-muted-foreground">中化裕民</p>
        <h1 className="mt-1 text-2xl font-semibold">業務 AI 助理</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">請用公司給的 Email 登入。</p>
      </header>

      {!error && !oauthError && signedOut && (
        <p className="mb-4 rounded-xl bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">{signedOut}</p>
      )}

      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="u01@meddemo.tw"
            className="h-12 px-3 text-base"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">密碼</Label>
          <div className="relative">
            <Input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 pr-13 pl-3 text-base"
            />
            {/* 手機上打錯字看不到，給一顆眼睛先確認再送出 */}
            <button
              type="button"
              aria-label={visible ? "隱藏密碼" : "顯示密碼"}
              onClick={() => setVisible((on) => !on)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-lg text-muted-foreground"
            >
              {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="mt-2 h-12 w-full text-base" disabled={busy || !email.trim() || !password}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : "登入"}
        </Button>
      </form>

      {/* 伺服器一家都沒設定（或還沒問到）就整區不出現，畫面跟只有 Email 登入時一樣 */}
      {providers && hasOAuth && (
        <section aria-label="其他登入方式" className="mt-6 flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            或
            <span className="h-px flex-1 bg-border" />
          </div>

          {providers.google && (
            <GoogleButton
              clientId={providers.google.client_id}
              text="signin_with"
              onCredential={(credential) => void submitOAuth({ provider: "google", body: { credential } })}
            />
          )}
          {providers.github && (
            <GitHubButton
              clientId={providers.github.client_id}
              mode="login"
              label="使用 GitHub 登入"
              className="h-12 w-full gap-2 text-base"
              disabled={oauthBusy}
              onError={setOauthError}
            />
          )}
          {providers.facebook && (
            <FacebookButton
              appId={providers.facebook.app_id}
              label="使用 Facebook 登入"
              variant="brand"
              className="h-12 w-full gap-2 text-base"
              disabled={oauthBusy}
              onToken={(token) => void submitOAuth({ provider: "facebook", body: { access_token: token } })}
              onError={setOauthError}
            />
          )}

          {oauthBusy && (
            <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              登入中…
            </p>
          )}
          {oauthError && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
              {oauthError}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            第三方帳號要先用 Email 登入、到「帳號設定」綁定過，才能在這裡使用。
          </p>
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        忘記密碼或還沒有帳號，請找你的主管重設，這個版本不能自己申請。
      </p>
    </div>
  )
}
