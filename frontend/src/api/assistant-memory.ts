import { ApiError, request } from "@/api/client"
import type { Entry, ToolRun, Utterance } from "@/ask/conversation"

export type StoredEntry =
  | (Omit<ToolRun, "ask"> & { ask_id?: string })
  | (Omit<Utterance, "attachment"> & { attachment_id?: number })
export type StoredNode = {
  id: string
  label?: string | null
  note?: string | null
  deleted: boolean
}
export type MemoryChanges = { entries: StoredEntry[]; nodes: StoredNode[] }
export type AccountMemory = { entries: Entry[]; nodes: StoredNode[] }

export function getAccountMemory(signal: AbortSignal) {
  return request<AccountMemory>("/api/assistant-memory", {
    signal,
    cache: "no-store",
  })
}

/** 固定送出這次登入的 token；換帳號後，排隊中的資料也不會寫進另一人的記憶。 */
export async function saveAccountMemory(
  changes: MemoryChanges,
  token: string,
  closing = false
) {
  const body = JSON.stringify(changes)
  const response = await fetch("/api/assistant-memory", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
    keepalive: closing && new Blob([body]).size < 60_000,
  })
  if (!response.ok)
    throw new ApiError("帳號記憶尚未同步，請重試。", response.status)
}
