export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ErrorDetail = string | Array<string | { msg: string }> | undefined

// 後端的錯誤訊息都是寫給業務看的中文，直接顯示；驗證錯誤是一串，接成一句
function describe(detail: ErrorDetail, status: number) {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((d) => (typeof d === "string" ? d : d.msg)).join("；")
  return `伺服器回應 ${status}`
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(describe(body?.detail, response.status), response.status)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}
