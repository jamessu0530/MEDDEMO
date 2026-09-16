import { jsonBody, request } from "@/api/client"
import { signOut, type AuthUser, type Session } from "@/lib/auth"

/** Email 密碼登入；Email 不存在或密碼錯誤時後端回 401，訊息是寫給業務看的中文 */
export function login(email: string, password: string) {
  return request<Session>("/api/auth/login", jsonBody("POST", { email, password }))
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
