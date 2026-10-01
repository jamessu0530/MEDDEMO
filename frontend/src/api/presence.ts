import { jsonBody, request } from "@/api/client"

// 別人看到的狀態（後端 services/presence.py 算好的）：有空、忙碌、請勿打擾、馬上回來、離開、離線
export type PresenceStatus = "available" | "busy" | "dnd" | "brb" | "away" | "offline"

// choice 是自己選的，null 是自動；status 是別人看到的
export type MyPresence = { choice: PresenceStatus | null; status: PresenceStatus }

export function getMyPresence(signal?: AbortSignal) {
  return request<MyPresence>("/api/presence/me", { signal })
}

/** 手動選狀態；null 是重設回自動 */
export function setMyPresence(choice: PresenceStatus | null) {
  return request<MyPresence>("/api/presence/me", jsonBody("PUT", { choice }))
}

// 業務的心跳多帶的（lib/location-share.ts）：分享中帶最新的位置，瀏覽器拒絕定位時帶 location_denied，其他時候是空的
export type HeartbeatLocation = {
  location?: { lat: number; lng: number; accuracy: number | null }
  location_denied?: true
}

/** WebSocket 連不上時的心跳，回不是離線的人的狀態 */
export function pingPresence(active: boolean, extra: HeartbeatLocation = {}) {
  return request<{ statuses: Record<string, PresenceStatus> }>("/api/presence/ping", jsonBody("POST", { active, ...extra }))
}
