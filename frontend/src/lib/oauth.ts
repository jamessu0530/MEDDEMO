import { useCallback, useEffect, useState } from "react"

import { fetchProviders, type OAuthProviders } from "@/api/auth"

/*
 * 第三方登入（Google／GitHub／Facebook）的瀏覽器端工具。
 * 帳號是公司給的，第三方帳號不會自動開新帳號：要先用 Email 登入、到帳號設定綁定，之後才能用它登入。
 * 所以每一家都有兩種用途——「登入」與「綁定」，拿到的憑證一樣，只是送去的 API 不同（api/auth.ts）。
 */

export type OAuthProvider = "google" | "github" | "facebook"
export type OAuthMode = "login" | "link"

export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
}

/**
 * 伺服器設定了哪幾家；還沒問到回 null。
 * 問不到（沒網路、後端還沒更新）就一直是 null，畫面當作都沒設定：第三方區塊不出現，Email 登入照常。
 */
export function useProviders() {
  const [providers, setProviders] = useState<OAuthProviders | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchProviders(controller.signal)
      .then(setProviders)
      .catch(() => {
        // 見上方說明：不顯示錯誤，免得 Email 登入的畫面多一個看不懂的紅字
      })
    return () => controller.abort()
  }, [])
  return providers
}

// ── 外部 SDK 動態載入 ──────────────────────────────────────────────

export const GOOGLE_SDK = "https://accounts.google.com/gsi/client"
export const FACEBOOK_SDK = "https://connect.facebook.net/zh_TW/sdk.js"

// 同一支 script 只插一次；兩個元件同時要（登入頁的按鈕重畫）時共用同一個 Promise
const scripts = new Map<string, Promise<void>>()

function loadScript(src: string) {
  const cached = scripts.get(src)
  if (cached) return cached
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // 沒網路、被廣告阻擋器擋掉：拿掉這次的紀錄，按「再試一次」才會真的重新下載
      script.remove()
      scripts.delete(src)
      reject(new Error("load failed"))
    }
    document.head.appendChild(script)
  })
  scripts.set(src, promise)
  return promise
}

export type ScriptStatus = "idle" | "loading" | "ready" | "error"

/**
 * 需要的頁面、而且伺服器有設定這一家時才下載 SDK（enabled 為 false 就不動）。
 * 失敗時回 error，畫面自己顯示說明與 retry，不讓整頁壞掉。
 */
export function useScript(src: string, enabled: boolean) {
  const [result, setResult] = useState<{ src: string; attempt: number; ok: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadScript(src).then(
      () => alive && setResult({ src, attempt, ok: true }),
      () => alive && setResult({ src, attempt, ok: false })
    )
    return () => {
      alive = false
    }
  }, [src, enabled, attempt])

  // 狀態由「這一次嘗試的結果回來了沒」推出來，不必在 effect 裡同步 setState
  let status: ScriptStatus = "idle"
  if (enabled) {
    if (!result || result.src !== src || result.attempt !== attempt) status = "loading"
    else status = result.ok ? "ready" : "error"
  }
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { status, retry }
}

// ── Google Identity Services ─────────────────────────────────────

type GoogleCredentialResponse = { credential?: string }

type GoogleButtonOptions = {
  type: "standard"
  theme: "outline" | "filled_blue"
  size: "large"
  text: "signin_with" | "continue_with"
  shape: "rectangular"
  logo_alignment: "left"
  width: number
  locale: string
}

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
  }) => void
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
    FB?: FacebookSdk
  }
}

/*
 * google.accounts.id.initialize 是全域的，重複呼叫會蓋掉前一次的 callback（主控台還會警告），
 * 所以只初始化一次，callback 轉給「目前畫面上那顆按鈕」登記的處理函式。
 * 登入頁與帳號設定頁不會同時出現，同一時間只會有一個處理函式。
 */
let googleClientId: string | null = null
let googleHandler: ((credential: string) => void) | null = null

export function setGoogleHandler(handler: ((credential: string) => void) | null) {
  googleHandler = handler
}

export function renderGoogleButton(parent: HTMLElement, clientId: string, text: GoogleButtonOptions["text"]) {
  const id = window.google?.accounts.id
  if (!id) throw new Error("Google SDK 沒有載入")
  if (googleClientId !== clientId) {
    id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) googleHandler?.(response.credential)
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    })
    googleClientId = clientId
  }
  // StrictMode 或重新整理版面會再畫一次，先清空，免得出現兩顆
  parent.replaceChildren()
  id.renderButton(parent, {
    type: "standard",
    theme: "outline",
    size: "large",
    text,
    shape: "rectangular",
    logo_alignment: "left",
    // GIS 的寬度只收 200～400px 的固定值，照容器實際寬度給，手機上才會跟其他按鈕一樣寬
    width: Math.min(400, Math.max(200, Math.floor(parent.clientWidth))),
    locale: "zh_TW",
  })
}

// ── Facebook JS SDK ──────────────────────────────────────────────

type FacebookLoginResponse = { authResponse: { accessToken: string } | null }

type FacebookSdk = {
  init: (options: { appId: string; version: string; cookie: boolean; xfbml: boolean }) => void
  login: (callback: (response: FacebookLoginResponse) => void, options: { scope: string }) => void
}

let facebookAppId: string | null = null

/**
 * 跳出 Facebook 登入視窗，回傳 access token；使用者自己關掉視窗回 null。
 * 一定要在按鈕的 click 裡直接呼叫（SDK 要先載好），中間不能 await 別的東西，否則手機瀏覽器會把彈出視窗擋掉。
 */
export function facebookLogin(appId: string) {
  return new Promise<string | null>((resolve, reject) => {
    const FB = window.FB
    if (!FB) {
      reject(new Error("Facebook SDK 沒有載入"))
      return
    }
    if (facebookAppId !== appId) {
      FB.init({ appId, version: "v21.0", cookie: false, xfbml: false })
      facebookAppId = appId
    }
    try {
      // SDK 要求 callback 是一般函式，不能是 async function
      FB.login((response) => resolve(response.authResponse?.accessToken ?? null), { scope: "public_profile,email" })
    } catch (err) {
      // 例如在 http 網址上呼叫：Facebook 只允許 https 頁面登入
      reject(err)
    }
  })
}

// ── GitHub OAuth（整頁導走再導回 /auth/github/callback）──────────────

const GITHUB_PENDING_KEY = "meddemo:github-oauth"

export type GitHubPending = { state: string; mode: OAuthMode; redirectUri: string }

export function githubRedirectUri() {
  return `${location.origin}/auth/github/callback`
}

// 防 CSRF 的一次性亂數；crypto.randomUUID 只在 https（或 localhost）有，其他情況退回 getRandomValues
function randomState() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * 記下這次是登入還是綁定、state 是多少，然後整頁導去 GitHub 授權。
 * sessionStorage 存不進去（部分無痕模式）就擋下來，因為回來時沒辦法比對 state。
 */
export function startGitHub(clientId: string, mode: OAuthMode) {
  const pending: GitHubPending = { state: randomState(), mode, redirectUri: githubRedirectUri() }
  try {
    sessionStorage.setItem(GITHUB_PENDING_KEY, JSON.stringify(pending))
  } catch {
    throw new Error("這個瀏覽器不允許暫存登入資訊（可能是無痕模式），請換一般視窗再試一次")
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: pending.redirectUri,
    scope: "read:user user:email",
    state: pending.state,
  })
  // URLSearchParams 把空白編成 +，scope 照 GitHub 文件寫成 %20
  location.assign(`https://github.com/login/oauth/authorize?${params.toString().replaceAll("+", "%20")}`)
}

/** callback 頁讀出出發前記下的資訊；讀不到或格式不對回 null */
export function readGitHubPending(): GitHubPending | null {
  try {
    const raw = sessionStorage.getItem(GITHUB_PENDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<GitHubPending>
    if (typeof value.state !== "string" || (value.mode !== "login" && value.mode !== "link")) return null
    return { state: value.state, mode: value.mode, redirectUri: value.redirectUri ?? githubRedirectUri() }
  } catch {
    return null
  }
}

/** state 只能用一次：callback 頁一開始處理就清掉，重新整理或按上一頁回來都不會再送一次 */
export function clearGitHubPending() {
  try {
    sessionStorage.removeItem(GITHUB_PENDING_KEY)
  } catch {
    // 清不掉也沒關係：GitHub 的 code 只能換一次，重送會被後端拒絕
  }
}
