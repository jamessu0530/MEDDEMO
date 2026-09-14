import type { AskKind } from "@/api/asks"
import { request } from "@/api/client"

// 一段語音問答的連線資料。token 是只能用一次的臨時金鑰；config 是後端鎖在金鑰裡的同一份 Live 設定
export type VoiceSession = {
  token: string
  model: string
  api_version: string
  expires_at: string
  config: Record<string, unknown>
  tool_kinds: Record<string, AskKind>
}

export function startVoiceSession() {
  return request<VoiceSession>("/api/voice/session", { method: "POST" })
}
