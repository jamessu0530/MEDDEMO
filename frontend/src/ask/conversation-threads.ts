import {
  createConversation,
  type Conversation,
  type Entry,
} from "@/ask/conversation"
import type { AskPageContext } from "@/ask/page-context"

export const LEGACY_THREAD = "legacy"
export type ConversationThread = {
  id: string
  title: string
  preview: string
  createdAt?: string
  updatedAt?: string
  page?: AskPageContext
  entries: Entry[]
}

export function conversationThreads(entries: Entry[]): ConversationThread[] {
  const groups = new Map<string, ConversationThread>()
  for (const entry of entries) {
    if (entry.ghost) continue
    const text = entry.kind === "tool" ? entry.question : entry.text.trim()
    if (!text && entry.kind !== "tool") continue
    const id = entry.threadId ?? LEGACY_THREAD
    let thread = groups.get(id)
    if (!thread) {
      thread = {
        id,
        title: "與熊熊滾的對話",
        preview: "",
        entries: [],
        createdAt: entry.createdAt,
      }
      groups.set(id, thread)
    }
    if (
      !thread.entries.some(
        (item) => item.kind === "user" || item.kind === "tool"
      ) &&
      (entry.kind === "user" || entry.kind === "tool")
    )
      thread.title = text.slice(0, 80) || thread.title
    thread.entries.push(entry)
    thread.preview = (
      entry.kind === "tool" ? entry.ask?.answer || entry.question : entry.text
    ).slice(0, 160)
    thread.updatedAt = entry.createdAt ?? thread.updatedAt
    if (entry.page) thread.page = entry.page
  }
  return [...groups.values()].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
  )
}

/** Only saved conversations reach account sync; a ghost store lives in memory alone. */
export function createConversationThreads(nextId: () => number) {
  const history = createConversation(nextId)
  const listeners = new Set<() => void>()
  let selected = false

  function normal(id: string): Conversation {
    let source: Entry[] | undefined
    let snapshot: Entry[] = []
    const metadata = () => ({
      threadId: id,
      createdAt: new Date().toISOString(),
    })
    return {
      ...history,
      getSnapshot: () => {
        const next = history.getSnapshot()
        if (next !== source) {
          source = next
          snapshot = next.filter(
            (entry) => (entry.threadId ?? LEGACY_THREAD) === id
          )
        }
        return snapshot
      },
      addUtterance: (kind, via, text, options) =>
        history.addUtterance(kind, via, text, { ...metadata(), ...options }),
      addToolRun: (kind, question, state) =>
        history.addToolRun(kind, question, { ...metadata(), ...state }),
    }
  }
  function make(
    ghost = false,
    id: string = crypto.randomUUID()
  ): ActiveConversation {
    return {
      id,
      ghost,
      conversation: ghost
        ? createConversation(nextId, () => ({
            threadId: id,
            ghost: true,
            createdAt: new Date().toISOString(),
          }))
        : normal(id),
    }
  }
  let current = make()
  function select(next: ActiveConversation) {
    selected = true
    current = next
    listeners.forEach((listener) => listener())
  }
  return {
    history,
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    startNew: () => select(make()),
    enterGhost: () => {
      if (!current.ghost) select(make(true))
    },
    resume(id: string) {
      if (
        !conversationThreads(history.getSnapshot()).some(
          (thread) => thread.id === id
        )
      )
        return false
      select(make(false, id))
      return true
    },
    restoreLatest() {
      if (selected || current.conversation.getSnapshot().length) return
      const latest = conversationThreads(history.getSnapshot())[0]
      if (latest) select(make(false, latest.id))
    },
  }
}

export type ActiveConversation = {
  id: string
  ghost: boolean
  conversation: Conversation
}

/** Stored paths can only return to an internal page. */
export function conversationPath(page?: AskPageContext) {
  const path = page?.path ?? "/orders"
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    /^\/(auth|login|register)(\/|\?|$)/.test(path)
  )
    return "/orders"
  return path
}
