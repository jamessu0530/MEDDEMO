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

// 502／503／504 沒帶後端的說明：是 Nginx、Traefik 或 Cloudflare 回的，業務看狀態碼看不懂。
// 後端自己回的 502 也可能到不了手機：2026-10-02 Nginx 記到送出 67 bytes 的「熊熊滾這次沒聽懂」，
// 畫面上卻只有「伺服器回應 502」，說明在 Traefik 或 Cloudflare 那一段被換掉了（Traefik 沒設錯誤頁，多半是 Cloudflare）
const GATEWAY = new Set([502, 503, 504])

// 後端的錯誤訊息都是寫給業務看的中文，直接顯示；驗證錯誤是一串，接成一句
function describe(detail: ErrorDetail, status: number) {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((d) => (typeof d === "string" ? d : d.msg)).join("；")
  if (GATEWAY.has(status)) return "伺服器暫時沒有回應，請再試一次"
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

/** 上傳檔案（FormData）並回報進度。fetch 拿不到上傳進度，所以用 XMLHttpRequest；錯誤處理跟 request 一樣 */
export function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", path)
    withAuth().forEach((value, key) => xhr.setRequestHeader(key, value))
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new ApiError("連不上伺服器，請再試一次", 0))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T)
        return
      }
      const message = describe(xhr.response?.detail, xhr.status)
      if (xhr.status === 401) signOut(message)
      reject(new ApiError(message, xhr.status))
    }
    xhr.send(form)
  })
}

