import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { linkProvider, oauthLogin, type OAuthCredential } from "@/api/auth"
import { Button } from "@/components/ui/button"
import { playInk } from "@/ink/ink"
import { readToken, refreshUser, signIn, useAuth } from "@/lib/auth"
import {
  PROVIDER_LABEL,
  clearOAuthPending,
  inspectGitHubReturn,
  inspectGoogleReturn,
  readOAuthPending,
  type OAuthMode,
  type RedirectProvider,
} from "@/lib/oauth"

type Outcome =
  | { kind: "working"; mode: OAuthMode; credential: OAuthCredential; from?: string }
  | { kind: "error"; mode: OAuthMode | null; message: string }

/**
 * 看網址上帶回來的東西跟出發前記在 sessionStorage 的是否對得上（lib/oauth.ts）。
 * 只讀不寫（清掉紀錄在 effect 裡做），StrictMode 呼叫兩次結果也一樣。
 */
function inspect(provider: RedirectProvider): Outcome {
  const pending = readOAuthPending(provider)
  const result =
    provider === "github" ? inspectGitHubReturn(location.search, pending) : inspectGoogleReturn(location.hash, pending)
  if (!result.ok) return { kind: "error", mode: pending?.mode ?? null, message: result.message }
  if (result.pending.mode === "link" && !readToken()) {
    return {
      kind: "error",
      mode: "link",
      message: `登入已過期，請先用 Email 登入，再到帳號設定綁定 ${PROVIDER_LABEL[provider]}。`,
    }
  }
  return { kind: "working", mode: result.pending.mode, credential: result.credential, from: result.pending.from }
}

/**
 * /auth/github/callback、/auth/google/callback：授權完導回這裡，不需要登入就進得來（登入流程也會走到）。
 * 出發前記下的是「登入」就換登入後回原本要去的那一頁（沒有就回首頁），是「綁定」就綁到目前帳號後回帳號設定。
 */
export function OAuthCallbackPage({ provider }: { provider: RedirectProvider }) {
  const navigate = useNavigate()
  const session = useAuth()
  const [outcome, setOutcome] = useState<Outcome>(() => inspect(provider))
  // GitHub 的 code 只能換一次；StrictMode 開發時 effect 會跑兩次，第二次不能再送
  const started = useRef(false)
  const label = PROVIDER_LABEL[provider]

  useEffect(() => {
    if (started.current) return
    started.current = true
    // state 只能用一次，不管成功與否都清掉
    clearOAuthPending(provider)
    // Google 的 ID token 在網址 # 後面：讀完就從網址列拿掉，不留在瀏覽紀錄裡
    if (location.hash) history.replaceState(history.state, "", `${location.pathname}${location.search}`)
    if (outcome.kind !== "working") return

    const fail = (err: unknown) =>
      setOutcome({
        kind: "error",
        mode: outcome.mode,
        message: err instanceof Error ? err.message : "連不上伺服器，請確認網路後再試一次",
      })

    if (outcome.mode === "login") {
      oauthLogin(outcome.credential)
        .then((result) => {
          // 等墨蓋滿才登入，理由同登入頁（pages/login.tsx 的 enter）
          playInk("splat", () => {
            signIn(result)
            navigate(outcome.from ?? "/", { replace: true })
          })
        })
        .catch(fail)
    } else {
      linkProvider(outcome.credential)
        .then((user) => {
          refreshUser(user)
          navigate("/settings", { replace: true, state: { linked: provider } })
        })
        .catch(fail)
    }
  }, [outcome, navigate, provider])

  if (outcome.kind === "working") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p role="status" className="text-sm">
          {outcome.mode === "login" ? `正在用 ${label} 登入…` : `正在綁定 ${label}…`}
        </p>
      </div>
    )
  }

  // 綁定失敗而且還登入著，回帳號設定；其他情況（登入失敗、登入已過期）回登入頁
  const backToSettings = outcome.mode === "link" && session
  return (
    <div className="flex min-h-svh flex-col justify-center gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold">{outcome.mode === "link" ? `${label} 沒有綁定成功` : `${label} 登入沒有完成`}</h1>
      <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
        {outcome.message}
      </p>
      <Button asChild className="h-12 w-full text-base">
        <Link to={backToSettings ? "/settings" : "/login"} replace>
          {backToSettings ? "回帳號設定" : "回登入頁"}
        </Link>
      </Button>
    </div>
  )
}
