import type { Attachment } from "@/api/attachments"
import { jsonBody, request, upload } from "@/api/client"
import type { PresenceStatus } from "@/api/presence"

// national 全國；region 整區；team 一位主管帶的小組；place 地點（縣市，台北市到行政區）；customer 一家客戶的討論串
export type ChannelKind = "national" | "region" | "team" | "place" | "customer"

export type Channel = {
  id: number
  kind: ChannelKind
  name: string
  // 所在的區（TW.N），頻道列表依這個分組；全國與封存的頻道是 null
  region_id: string | null
  parent_id: number | null
  // 主管已經不在的小組頻道：只剩 IT 看得到，不能再發言
  archived: boolean
  customer_id: string | null
  // 輸入框上的提示：誰看得到這裡的訊息
  audience: string
  unread: number
  last_message_at: string | null
  // 成員裡不是離線的人數，不算自己
  online: number
}

// 成員照組織位置算：主管與組員、整區的人；IT 只算全國頻道的成員
export type ChannelMember = { id: string; name: string; status: PresenceStatus }

export type ChannelMessage = {
  id: number
  // user 人發的；ai 熊熊滾；notice 拜訪的風險通報
  kind: "user" | "ai" | "notice"
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
  mine: boolean
  attachments: Attachment[]
  // IT 刪掉的訊息：內容已經換成固定的一句
  deleted: boolean
  // 風險通報附的拜訪，點了進拜訪結果頁
  visit_id?: string | null
  // 有沒有叫熊熊滾
  mentions_ai: boolean
  // 熊熊滾的回答指向提問那一則
  reply_to_id: number | null
}

/** 看得到的頻道，不含客戶討論串；後端已經依全國 → 各區排好 */
export function listChannels(signal?: AbortSignal) {
  return request<Channel[]>("/api/channels", { signal })
}

/** 分頁列紅點的數字：全國、自己的區、自己的小組、自己負責的客戶討論串 */
export function getChannelUnread(signal?: AbortSignal) {
  return request<{ count: number }>("/api/channels/unread", { signal })
}

export function getChannel(id: number, signal?: AbortSignal) {
  return request<Channel>(`/api/channels/${id}`, { signal })
}

/** 由舊到新。after 給輪詢用，before 給往上捲，around 給從看板跳回某一則（前後各 20 則）；都不給就是最新的一頁 */
export function listMessages(id: number, params: { after?: number; before?: number; around?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (params.after !== undefined) query.set("after", String(params.after))
  if (params.before !== undefined) query.set("before", String(params.before))
  if (params.around !== undefined) query.set("around", String(params.around))
  const suffix = query.toString() ? `?${query}` : ""
  return request<ChannelMessage[]>(`/api/channels/${id}/messages${suffix}`, { signal })
}

/** 發言。有附檔案就用 multipart 上傳並回報進度，沒有就照舊送 JSON */
export function postMessage(id: number, body: string, files: File[] = [], onProgress?: (fraction: number) => void) {
  const path = `/api/channels/${id}/messages`
  if (!files.length) return request<ChannelMessage>(path, jsonBody("POST", { body }))
  const form = new FormData()
  form.append("body", body)
  for (const file of files) form.append("files", file, file.name)
  return upload<ChannelMessage>(path, form, onProgress)
}

/** IT 刪訊息：附件刪掉、內容換成固定的一句 */
export function deleteMessage(messageId: number) {
  return request<void>(`/api/channels/messages/${messageId}`, { method: "DELETE" })
}

export function markRead(id: number, messageId: number) {
  return request<void>(`/api/channels/${id}/read`, jsonBody("POST", { message_id: messageId }))
}

/** 成員與狀態，依名字排。狀態之後的變化由 WebSocket 推來（lib/presence.ts） */
export function listMembers(id: number, signal?: AbortSignal) {
  return request<ChannelMember[]>(`/api/channels/${id}/members`, { signal })
}

/** 地點頻道底下有人發過言的客戶討論串 */
export function listThreads(id: number, signal?: AbortSignal) {
  return request<Channel[]>(`/api/channels/${id}/threads`, { signal })
}

/** 這家客戶的討論串，沒有就建一個 */
export function openCustomerThread(customerId: string) {
  return request<Channel>(`/api/customers/${customerId}/thread`, { method: "POST" })
}
