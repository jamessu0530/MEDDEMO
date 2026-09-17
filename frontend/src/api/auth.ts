import { jsonBody, request } from "@/api/client"
import { signOut, type AuthUser, type Session } from "@/lib/auth"

/** Email 密碼登入；Email 不存在或密碼錯誤時後端回 401，訊息是寫給業務看的中文 */
export function login(email: string, password: string) {
  return request<Session>("/api/auth/login", jsonBody("POST", { email, password }))
}

/** 用 Email 建立帳號，建好直接登入。Email 已經註冊過回 409，訊息直接顯示 */
export function register(name: string, email: string, password: string) {
  return request<Session>("/api/auth/register", jsonBody("POST", { name, email, password }))
}

/** 這組 token 現在代表誰。過期或在別的裝置登入過會回 401（由 api/client.ts 統一處理） */
export function fetchMe(signal?: AbortSignal) {
  return request<AuthUser>("/api/auth/me", { signal })
}

/**
 * 改密碼。後端改完會把 sessionVersion 加一，手上這張 token 當場失效，
 * 所以它直接發一張新的回來；呼叫的人要用 signIn 換掉本機存的，不然下一個請求就被登出。
 */
export function changePassword(currentPassword: string, newPassword: string) {
  return request<Session>(
    "/api/auth/change-password",
    jsonBody("POST", { current_password: currentPassword, new_password: newPassword })
  )
}

/** 登出：先讓後端作廢這組 token，再清掉這支手機存的登入狀態 */
export async function signOutSession() {
  try {
    await request<void>("/api/auth/logout", { method: "POST" })
  } catch {
    // 沒訊號時後端不會知道，token 會留到自己過期；這支手機一樣要登出
  }
  signOut()
}

// ── 第三方登入（Google／GitHub／Facebook）────────────────────────────

/** 伺服器設定了哪幾家；null 代表那一家沒設定，按鈕與綁定都不顯示 */
export type OAuthProviders = {
  google: { client_id: string } | null
  github: { client_id: string } | null
  facebook: { app_id: string } | null
}

/** 各家送去後端的憑證：Google 是 ID token、GitHub 是授權碼（要附同一個 redirect_uri）、Facebook 是 access token */
export type OAuthCredential =
  | { provider: "google"; body: { credential: string } }
  | { provider: "github"; body: { code: string; redirect_uri: string } }
  | { provider: "facebook"; body: { access_token: string } }

/** 不用登入就能問；登入頁與帳號設定都靠它決定要列哪幾家 */
export function fetchProviders(signal?: AbortSignal) {
  return request<OAuthProviders>("/api/auth/providers", { signal })
}

/**
 * 用綁定過的第三方帳號登入，回傳跟 Email 登入一樣的 Session。
 * 沒綁定過回 401，訊息會教他先用 Email 登入再去帳號設定綁定，直接顯示即可。
 */
export function oauthLogin({ provider, body }: OAuthCredential) {
  return request<Session>(`/api/auth/oauth/${provider}/login`, jsonBody("POST", body))
}

/** 把第三方帳號綁到目前登入的帳號；已經綁在別人身上回 409 */
export function linkProvider({ provider, body }: OAuthCredential) {
  return request<AuthUser>(`/api/auth/oauth/${provider}/link`, jsonBody("POST", body))
}

/** 解除綁定；Email 密碼登入不受影響 */
export function unlinkProvider(provider: OAuthCredential["provider"]) {
  return request<AuthUser>(`/api/auth/oauth/${provider}`, { method: "DELETE" })
}
