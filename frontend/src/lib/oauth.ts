import { useEffect, useState } from "react"

import { fetchProviders, type OAuthCredential, type OAuthProviders } from "@/api/auth"

/*
 * 第三方登入（Google／GitHub）的瀏覽器端工具。
 * 第一次登入會自動建立帳號；公司給的帳號也能先用 Email 登入，再到帳號設定綁定。
 * 所以每一家都有兩種用途——「登入」與「綁定」，拿到的憑證一樣，只是送去的 API 不同（api/auth.ts）。
 */

export type OAuthProvider = "google" | "github"
export type OAuthMode = "login" | "link"

export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
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

// ── 整頁導走再導回 /auth/<provider>/callback（Google、GitHub）─────────────

/*
 * Google 原本用 Identity Services 的按鈕，按下去開一個彈出視窗登入，選完帳號由那個視窗把結果交回這一頁。
 * 在 LINE 的內建瀏覽器裡，選完帳號後那個視窗停在空白頁、結果交不回來，所以 Google 也改成跟 GitHub 一樣，
 * 整頁導去授權、再導回 callback 頁（pages/oauth-callback.tsx），中間不開任何視窗。
 */

/** 透過整頁重新導向完成授權的供應商 */
export type RedirectProvider = OAuthProvider

export type OAuthPending = {
  state: string
  mode: OAuthMode
  redirectUri: string
  /** Google 才有：導回來的 ID token 裡要帶著同一個值，證明是這一次要的，不是別處拿來的 */
  nonce?: string
  /** 登入完要回去的那一頁（被擋下來之前要去的）；沒有就回首頁 */
  from?: string
}

const pendingKey = (provider: RedirectProvider) => `meddemo:${provider}-oauth`

export function oauthRedirectUri(provider: RedirectProvider) {
  return `${location.origin}/auth/${provider}/callback`
}

// 防 CSRF 的一次性亂數；crypto.randomUUID 只在 https（或 localhost）有，其他情況退回 getRandomValues
function randomState() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
}

// URLSearchParams 把空白編成 +，scope 照兩家文件寫成 %20
const query = (params: Record<string, string>) => new URLSearchParams(params).toString().replaceAll("+", "%20")

/**
 * 記下這次是登入還是綁定、state 是多少，然後整頁導去授權。
 * sessionStorage 存不進去（部分無痕模式）就擋下來，因為回來時沒辦法比對 state。
 */
export function startOAuthRedirect(provider: RedirectProvider, clientId: string, mode: OAuthMode, from?: string) {
  const pending: OAuthPending = { state: randomState(), mode, redirectUri: oauthRedirectUri(provider), from }
  let url: string
  if (provider === "github") {
    url = `https://github.com/login/oauth/authorize?${query({
      client_id: clientId,
      redirect_uri: pending.redirectUri,
      scope: "read:user user:email",
      state: pending.state,
    })}`
  } else {
    // 只要 ID token（後端驗的跟原本 Identity Services 給的是同一種），Google 放在網址的 # 後面帶回來
    pending.nonce = randomState()
    url = `https://accounts.google.com/o/oauth2/v2/auth?${query({
      client_id: clientId,
      redirect_uri: pending.redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: pending.nonce,
      state: pending.state,
      // 每次都讓人選帳號，手機上登著好幾個 Google 帳號時才選得到要的那個
      prompt: "select_account",
    })}`
  }
  try {
    sessionStorage.setItem(pendingKey(provider), JSON.stringify(pending))
  } catch {
    throw new Error("這個瀏覽器不允許暫存登入資訊（可能是無痕模式），請換一般視窗再試一次")
  }
  location.assign(url)
}

/** callback 頁讀出出發前記下的資訊；讀不到或格式不對回 null */
export function readOAuthPending(provider: RedirectProvider): OAuthPending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(provider))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<OAuthPending>
    if (typeof value.state !== "string" || (value.mode !== "login" && value.mode !== "link")) return null
    return {
      state: value.state,
      mode: value.mode,
      redirectUri: value.redirectUri ?? oauthRedirectUri(provider),
      nonce: typeof value.nonce === "string" ? value.nonce : undefined,
      // 只接受站內的路徑，免得被導去別的網站
      from: typeof value.from === "string" && value.from.startsWith("/") && !value.from.startsWith("//") ? value.from : undefined,
    }
  } catch {
    return null
  }
}

/** state 只能用一次：callback 頁一開始處理就清掉，重新整理或按上一頁回來都不會再送一次 */
export function clearOAuthPending(provider: RedirectProvider) {
  try {
    sessionStorage.removeItem(pendingKey(provider))
  } catch {
    // 清不掉也沒關係：GitHub 的 code 只能換一次，Google 的 nonce 比對過就沒用了
  }
}

export type OAuthReturn = { ok: true; credential: OAuthCredential; pending: OAuthPending } | { ok: false; message: string }

const retryHint = (provider: RedirectProvider) => `請回去重新按一次 ${PROVIDER_LABEL[provider]} 按鈕。`

/** 兩家共同的檢查：對方回報錯誤、找不到出發前的紀錄、state 對不上。沒問題回出發前的紀錄，有問題回要顯示的說明 */
function checkReturn(provider: RedirectProvider, params: URLSearchParams, pending: OAuthPending | null): OAuthPending | string {
  const label = PROVIDER_LABEL[provider]
  const denied = params.get("error")
  if (denied) {
    return denied === "access_denied"
      ? `你在 ${label} 取消了授權，這次沒有完成。`
      : `${label} 回報錯誤：${params.get("error_description") ?? denied}。${retryHint(provider)}`
  }
  if (!pending) return `找不到這次登入的紀錄（可能在新分頁打開，或這個網址已經處理過）。${retryHint(provider)}`
  // 防 CSRF：state 跟出發前產生的不一樣，代表這個網址不是從這支手機發起的，一律擋下
  if (params.get("state") !== pending.state) return `安全檢查沒有通過，這次已經擋下。${retryHint(provider)}`
  return pending
}

/** GitHub 把 code 放在 ?code=… 帶回來 */
export function inspectGitHubReturn(search: string, pending: OAuthPending | null): OAuthReturn {
  const params = new URLSearchParams(search)
  const checked = checkReturn("github", params, pending)
  if (typeof checked === "string") return { ok: false, message: checked }
  const code = params.get("code")
  if (!code) return { ok: false, message: `GitHub 沒有帶回授權碼。${retryHint("github")}` }
  return { ok: true, credential: { provider: "github", body: { code, redirect_uri: checked.redirectUri } }, pending: checked }
}

/** ID token 中間那段是 base64url 的 JSON；讀不出來回 null（簽章交給後端驗） */
function idTokenNonce(token: string) {
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")
    const json = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))) as { nonce?: unknown }
    return typeof json.nonce === "string" ? json.nonce : null
  } catch {
    return null
  }
}

/** Google 把 ID token 放在 #id_token=… 帶回來（錯誤也在 # 後面） */
export function inspectGoogleReturn(hash: string, pending: OAuthPending | null): OAuthReturn {
  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const checked = checkReturn("google", params, pending)
  if (typeof checked === "string") return { ok: false, message: checked }
  const credential = params.get("id_token")
  if (!credential) return { ok: false, message: `Google 沒有帶回登入資料。${retryHint("google")}` }
  if (!checked.nonce || idTokenNonce(credential) !== checked.nonce) {
    return { ok: false, message: `安全檢查沒有通過，這次已經擋下。${retryHint("google")}` }
  }
  return { ok: true, credential: { provider: "google", body: { credential } }, pending: checked }
}
