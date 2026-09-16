import { readToken, signOut } from "@/lib/auth"

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ErrorDetail = string | Array<string | { msg: string }> | undefined

// 登入自己的 401 是 Email 或密碼不對、第三方帳號還沒綁定，不是登入過期，不能把本機的登入狀態清掉
const LOGIN_PATHS = /^\/api\/auth\/(login|oauth\/[a-z]+\/login)$/

// 後端的錯誤訊息都是寫給業務看的中文，直接顯示；驗證錯誤是一串，接成一句
function describe(detail: ErrorDetail, status: number) {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((d) => (typeof d === "string" ? d : d.msg)).join("；")
  return `伺服器回應 ${status}`
}

// 每個請求都帶登入的 token；上傳錄音是 FormData，這裡不動 Content-Type，交給瀏覽器自己帶邊界字串
function withAuth(init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const token = readToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  return headers
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: withAuth(init) })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = describe(body?.detail, response.status)
    // token 過期或被別的裝置頂掉：清掉登入狀態，App.tsx 看到沒登入就會導回登入頁，不必每一頁各寫一次
    if (response.status === 401 && !LOGIN_PATHS.test(path)) signOut(message)
    throw new ApiError(message, response.status)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}
