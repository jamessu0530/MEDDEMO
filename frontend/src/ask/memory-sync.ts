import {
  getAccountMemory,
  saveAccountMemory,
  type StoredEntry,
  type StoredNode,
  type MemoryChanges,
} from "@/api/assistant-memory"
import type { Conversation, Entry } from "@/ask/conversation"
import type { MapEdits, MapEditsStore } from "@/ask/memory-map-edits"

export type MemoryStatus = "loading" | "saving" | "saved" | "error"
const outboxOwners = new Map<string, symbol>()

export function storedEntry(entry: Entry): StoredEntry {
  if (entry.kind === "tool") {
    const { ask, ...data } = entry
    return { ...data, ask_id: ask?.id }
  }
  const { attachment, ...data } = entry
  delete data.demo
  delete data.demoPath
  // 示範是一次操作，不在還原歷史時重播。
  return { ...data, attachment_id: attachment?.id }
}

function nodeSnapshot(edits: MapEdits) {
  const deleted = new Set(edits.deleted)
  return new Map(
    [...new Set([...Object.keys(edits.nodes), ...deleted])].map((id) => [
      id,
      { id, ...edits.nodes[id], deleted: deleted.has(id) } as StoredNode,
    ])
  )
}

function editSnapshot(nodes: Iterable<StoredNode>): MapEdits {
  const edits: MapEdits = { nodes: {}, deleted: [] }
  for (const node of nodes) {
    if (node.label)
      edits.nodes[node.id] = { label: node.label, note: node.note ?? "" }
    if (node.deleted) edits.deleted.push(node.id)
  }
  return edits
}

/** 裝置只保存待同步佇列；長期資料在後端，佇列以登入帳號分開，成功後移除。 */
export function syncAccountMemory(
  userId: string,
  token: string,
  conversation: Conversation,
  edits: MapEditsStore
) {
  const key = `meddemo:memory-outbox:${userId}`
  const owner = Symbol()
  outboxOwners.set(key, owner)
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  const pendingEntries = new Map<number, StoredEntry>()
  const pendingNodes = new Map<string, StoredNode>()
  const changedNodes = new Map<string, StoredNode>()
  let status: MemoryStatus = "loading"
  let applying = false
  let stopped = false
  let loaded = false
  let readFailed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<void> | null = null
  let previousEntries = new Map<number, Entry>()
  let previousNodes = new Map<string, StoredNode>()
  const encoded = new Map<number, string>()
  const setStatus = (next: MemoryStatus) => {
    if (status === next) return
    status = next
    for (const listener of listeners) listener()
  }
  try {
    const outbox = JSON.parse(
      localStorage.getItem(key) ?? "null"
    ) as MemoryChanges | null
    for (const entry of outbox?.entries ?? [])
      if (!entry.ghost) pendingEntries.set(entry.id, entry)
    for (const node of outbox?.nodes ?? []) pendingNodes.set(node.id, node)
  } catch {
    /* 瀏覽器禁止儲存或舊佇列損壞時，仍使用伺服器資料。 */
  }

  function persistOutbox() {
    if (outboxOwners.get(key) !== owner) return
    try {
      if (pendingEntries.size || pendingNodes.size)
        localStorage.setItem(
          key,
          JSON.stringify({
            entries: [...pendingEntries.values()],
            nodes: [...pendingNodes.values()],
          })
        )
      else localStorage.removeItem(key)
    } catch {
      /* 後端同步仍會繼續；失敗狀態在畫面顯示。 */
    }
  }

  async function flush(closing = false): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (saving) {
      await saving
      if (pendingEntries.size || pendingNodes.size) return flush(closing)
      return
    }
    if (!pendingEntries.size && !pendingNodes.size) return
    setStatus("saving")
    saving = (async () => {
      while (pendingEntries.size || pendingNodes.size) {
        const entries = [...pendingEntries.values()].slice(0, 100)
        const nodes = [...pendingNodes.values()].slice(0, 100)
        await saveAccountMemory({ entries, nodes }, token, closing)
        for (const entry of entries)
          if (pendingEntries.get(entry.id) === entry)
            pendingEntries.delete(entry.id)
        for (const node of nodes)
          if (pendingNodes.get(node.id) === node) pendingNodes.delete(node.id)
        persistOutbox()
      }
      setStatus(loaded ? "saved" : readFailed ? "error" : "loading")
    })()
    try {
      await saving
    } catch (error) {
      setStatus("error")
      throw error
    } finally {
      saving = null
    }
  }

  function schedule() {
    persistOutbox()
    setStatus("saving")
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush().catch(() => {})
    }, 200)
  }
  const unsubscribeEntries = conversation.subscribe(() => {
    if (applying || stopped) return
    const current = conversation.getSnapshot()
    for (const entry of current) {
      if (entry.ghost) continue
      if (previousEntries.get(entry.id) === entry) continue
      const stored = storedEntry(entry),
        json = JSON.stringify(stored)
      if (encoded.get(entry.id) === json) continue
      encoded.set(entry.id, json)
      pendingEntries.set(entry.id, stored)
    }
    previousEntries = new Map(current.map((entry) => [entry.id, entry]))
    if (pendingEntries.size) schedule()
  })
  const unsubscribeNodes = edits.subscribe(() => {
    if (applying || stopped) return
    const next = nodeSnapshot(edits.getSnapshot())
    for (const id of new Set([...previousNodes.keys(), ...next.keys()])) {
      const node = next.get(id) ?? { id, deleted: false }
      if (JSON.stringify(previousNodes.get(id)) !== JSON.stringify(node)) {
        pendingNodes.set(id, node)
        changedNodes.set(id, node)
      }
    }
    previousNodes = next
    if (pendingNodes.size) schedule()
  })

  async function load() {
    readFailed = false
    try {
      const remote = await getAccountMemory(controller.signal)
      if (stopped) return
      const byId = new Map(remote.entries.map((entry) => [entry.id, entry]))
      const byAsk = new Map(
        remote.entries.flatMap((entry) =>
          entry.kind === "tool" && entry.ask
            ? [[entry.ask.id, entry] as const]
            : []
        )
      )
      const restored = [...pendingEntries.values()].map((entry): Entry => {
        if (entry.kind === "tool") {
          const { ask_id, ...data } = entry
          return {
            ...data,
            ask: ask_id ? (byAsk.get(ask_id)?.ask ?? null) : null,
            routing: false,
            choices: null,
            error:
              data.error ||
              (!ask_id && !data.clarification
                ? "上次查詢尚未完成，請重新提問。"
                : null),
          }
        }
        const { attachment_id, ...data } = entry
        const known = byId.get(entry.id)
        return {
          ...data,
          ...(known &&
          known.kind !== "tool" &&
          known.attachment?.id === attachment_id
            ? { attachment: known.attachment }
            : {}),
        }
      })
      const localEntries = [...restored, ...conversation.getSnapshot()]
      const localIds = new Set(localEntries.map((entry) => entry.id))
      const pendingAsks = new Set(
        localEntries.flatMap((entry) =>
          entry.kind === "tool" && entry.ask ? [entry.ask.id] : []
        )
      )
      const history = remote.entries.filter(
        (entry) =>
          entry.kind !== "tool" ||
          !entry.ask ||
          !pendingAsks.has(entry.ask.id) ||
          localIds.has(entry.id)
      )
      const nodes = new Map(remote.nodes.map((node) => [node.id, node]))
      for (const node of pendingNodes.values())
        nodes.set(node.id, { ...nodes.get(node.id), ...node })
      for (const node of changedNodes.values())
        nodes.set(node.id, { ...nodes.get(node.id), ...node })
      applying = true
      conversation.merge([...history, ...restored])
      edits.load(editSnapshot(nodes.values()))
      previousEntries = new Map(
        conversation.getSnapshot().map((entry) => [entry.id, entry])
      )
      for (const entry of conversation.getSnapshot())
        encoded.set(entry.id, JSON.stringify(storedEntry(entry)))
      previousNodes = nodeSnapshot(edits.getSnapshot())
      applying = false
      loaded = true
      setStatus(pendingEntries.size || pendingNodes.size ? "saving" : "saved")
      await flush()
    } catch {
      applying = false
      readFailed = true
      if (!stopped) setStatus("error")
    }
  }
  const ready = load()
  const retry = () => (loaded ? flush() : load())
  const online = () => {
    void retry().catch(() => {})
  }
  const pagehide = () => {
    void flush(true).catch(() => {})
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", online)
    window.addEventListener("pagehide", pagehide)
  }
  return {
    ready,
    flush,
    retry,
    getSnapshot: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stop: () => {
      stopped = true
      controller.abort()
      unsubscribeEntries()
      unsubscribeNodes()
      if (typeof window !== "undefined") {
        window.removeEventListener("online", online)
        window.removeEventListener("pagehide", pagehide)
      }
      void flush(true).catch(() => {})
    },
  }
}
