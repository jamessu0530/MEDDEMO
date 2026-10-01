import { request } from "@/api/client"

// 上班時間（後端 LOCATION_SHARE_HOURS）：星期 1（一）～7（日），start 起、end 前，台北時間
export type ShareHours = { weekdays: number[]; start: string; end: string }

// 業務首頁分享列要的：這個帳號會不會分享（主管與 IT 不會）、暫停了沒、主管是誰、上班時間
export type ShareState = {
  applies: boolean
  paused: boolean
  denied: boolean
  manager_name: string | null
  hours: ShareHours
}

export function getShareState(signal?: AbortSignal) {
  return request<ShareState>("/api/location/me", { signal })
}

/** 暫停分享：不再送位置，主管看到「暫停分享位置」 */
export function pauseSharing() {
  return request<ShareState>("/api/location/pause", { method: "POST" })
}

export function resumeSharing() {
  return request<ShareState>("/api/location/resume", { method: "POST" })
}
