import { useSyncExternalStore } from "react"

import type { Conversation, Entry } from "@/ask/conversation"

/** 把 React 隔離在 store 之外：store 本身不 import react，才能單獨測試 */
export function useConversation(conversation: Conversation): Entry[] {
  return useSyncExternalStore(conversation.subscribe, conversation.getSnapshot)
}
