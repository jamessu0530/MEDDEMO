import { jsonBody, request } from "@/api/client"

// 錄音時即時轉錄用的連線資料：只能用一次的臨時金鑰，與後端鎖在金鑰裡的同一份設定
export type TranscriptionSession = {
  token: string
  model: string
  api_version: string
  expires_at: string
  config: Record<string, unknown>
}

export function startTranscriptionSession(customerId: string) {
  return request<TranscriptionSession>("/api/transcription/session", jsonBody("POST", { customer_id: customerId }))
}
