import type { Attachment } from "@/api/attachments"
import { jsonBody, request } from "@/api/client"

// complaint 客訴；competitor 競品；todo 待辦；decision 決議；experience 經驗
export type MemoryCategory = "complaint" | "competitor" | "todo" | "decision" | "experience"

/** 這個頻道自己的重點 */
export type OwnItem = {
  id: number
  category: MemoryCategory
  text: string
  status: "open" | "done"
  due_date: string | null
  shared: boolean
  shared_text: string | null
  withdrawn: boolean
  // 改過內容的人；熊熊滾整理的是 null
  edited_by: string | null
  // 點一下捲到原始訊息
  source_message_ids: number[]
  attachments: Attachment[]
  shared_attachment_ids: number[]
  updated_at: string
}

/** 下層往上傳的重點：只有往上傳的寫法與附件，點不回原文 */
export type BelowItem = {
  id: number
  category: MemoryCategory
  text: string
  status: "open" | "done"
  due_date: string | null
  attachments: Attachment[]
  updated_at: string
}

export type Board = {
  own: OwnItem[]
  below: { channel_id: number; channel_name: string; items: BelowItem[] }[]
}

export type MemoryEdit = Partial<{
  text: string
  category: MemoryCategory
  due_date: string | null
  status: "open" | "done"
  shared_attachment_ids: number[]
}>

export function getBoard(channelId: number, signal?: AbortSignal) {
  return request<Board>(`/api/channels/${channelId}/board`, { signal })
}

export function editMemory(id: number, edit: MemoryEdit) {
  return request<void>(`/api/memory/${id}`, jsonBody("PATCH", edit))
}

export function deleteMemory(id: number) {
  return request<void>(`/api/memory/${id}`, { method: "DELETE" })
}

/** 撤回往上傳：所有上層的看板同時看不到，附件也一起；撤回之後不能再往上傳 */
export function withdrawMemory(id: number) {
  return request<void>(`/api/memory/${id}/withdraw`, { method: "POST" })
}
