import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { linkProvider, oauthLogin } from "@/api/auth"
import { Button } from "@/components/ui/button"
import { readToken, refreshUser, signIn, useAuth } from "@/lib/auth"
import { clearGitHubPending, readGitHubPending, type OAuthMode } from "@/lib/oauth"

type Outcome =
  | { kind: "working"; mode: OAuthMode; code: string; redirectUri: string }
  | { kind: "error"; mode: OAuthMode | null; message: string }

// 重新按一次按鈕就能解決的情況，統一這樣收尾
const RETRY_HINT = "請回去重新按一次 GitHub 按鈕。"

/**
 * 看網址上 GitHub 帶回來的東西跟出發前記在 sessionStorage 的是否對得上。
 * 只讀不寫（清掉紀錄在 effect 裡做），StrictMode 呼叫兩次結果也一樣。
 */
function inspect(): Outcome {
  const params = new URLSearchParams(location.search)
  const pending = readGitHubPending()
  const mode = pending?.mode ?? null

  const denied = params.get("error")
  if (denied) {
    const message =
      denied === "access_denied"
        ? "你在 GitHub 取消了授權，這次沒有完成。"
        : `GitHub 回報錯誤：${params.get("error_description") ?? denied}。${RETRY_HINT}`
    return { kind: "error", mode, message }
  }
  if (!pending) {
    return {
      kind: "error",
      mode,
      message: `找不到這次登入的紀錄（可能在新分頁打開，或這個網址已經處理過）。${RETRY_HINT}`,
    }
  }
  // 防 CSRF：state 跟出發前產生的不一樣，代表這個網址不是從這支手機發起的，一律擋下
  if (params.get("state") !== pending.state) {
    return { kind: "error", mode, message: `安全檢查沒有通過，這次已經擋下。${RETRY_HINT}` }
  }
  const code = params.get("code")
  if (!code) return { kind: "error", mode, message: `GitHub 沒有帶回授權碼。${RETRY_HINT}` }
  if (pending.mode === "link" && !readToken()) {
    return { kind: "error", mode, message: "登入已過期，請先用 Email 登入，再到帳號設定綁定 GitHub。" }
  }
  return { kind: "working", mode: pending.mode, code, redirectUri: pending.redirectUri }
}

/**
 * /auth/github/callback：GitHub 授權完導回這裡，不需要登入就進得來（登入流程也會走到）。
 * 出發前記下的是「登入」就換登入後回首頁，是「綁定」就綁到目前帳號後回帳號設定。
 */
export function GitHubCallbackPage() {
  const navigate = useNavigate()
  const session = useAuth()
  const [outcome, setOutcome] = useState<Outcome>(inspect)
  // GitHub 的 code 只能換一次；StrictMode 開發時 effect 會跑兩次，第二次不能再送
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // state 只能用一次，不管成功與否都清掉
    clearGitHubPending()
    if (outcome.kind !== "working") return

    const credential = {
      provider: "github",
      body: { code: outcome.code, redirect_uri: outcome.redirectUri },
    } as const
    const fail = (err: unknown) =>
      setOutcome({
        kind: "error",
        mode: outcome.mode,
        message: err instanceof Error ? err.message : "連不上伺服器，請確認網路後再試一次",
      })

    if (outcome.mode === "login") {
      oauthLogin(credential)
        .then((result) => {
          signIn(result)
          navigate("/", { replace: true })
        })
        .catch(fail)
    } else {
      linkProvider(credential)
        .then((user) => {
          refreshUser(user)
          navigate("/settings", { replace: true, state: { linked: "github" } })
        })
        .catch(fail)
    }
  }, [outcome, navigate])

  if (outcome.kind === "working") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p role="status" className="text-sm">
          {outcome.mode === "login" ? "正在用 GitHub 登入…" : "正在綁定 GitHub…"}
        </p>
      </div>
    )
  }

  // 綁定失敗而且還登入著，回帳號設定；其他情況（登入失敗、登入已過期）回登入頁
  const backToSettings = outcome.mode === "link" && session
  return (
    <div className="flex min-h-svh flex-col justify-center gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold">{outcome.mode === "link" ? "GitHub 沒有綁定成功" : "GitHub 登入沒有完成"}</h1>
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
