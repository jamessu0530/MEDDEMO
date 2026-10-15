import type { MemoryMap } from "@/ask/memory-map"

export type MapEdits = {
  nodes: Record<string, { label: string; note: string }>
  deleted: string[]
}
export type MapEditsStore = {
  getSnapshot: () => MapEdits
  subscribe: (listener: () => void) => () => void
  edit: (id: string, label: string, note: string) => void
  remove: (id: string) => void
  restore: (id?: string) => void
}

/** Personal map changes share the query session's lifetime; source evidence stays intact. */
export function createMapEditsStore(): MapEditsStore {
  let state: MapEdits = { nodes: {}, deleted: [] }
  const listeners = new Set<() => void>()
  const commit = (next: MapEdits) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    edit(id, label, note) {
      const title = label.trim().slice(0, 80)
      if (!title) return
      commit({
        ...state,
        nodes: {
          ...state.nodes,
          [id]: { label: title, note: note.trim().slice(0, 1200) },
        },
      })
    },
    remove(id) {
      if (!state.deleted.includes(id))
        commit({ ...state, deleted: [...state.deleted, id] })
    },
    restore(id) {
      commit({
        ...state,
        deleted: id ? state.deleted.filter((value) => value !== id) : [],
      })
    },
  }
}

export function applyMapEdits(graph: MemoryMap, edits: MapEdits): MemoryMap {
  const deleted = new Set(edits.deleted)
  const latestVisible =
    [...graph.nodes]
      .reverse()
      .find((node) => node.kind === "question" && !deleted.has(node.id))?.id ??
    null
  return {
    ...graph,
    nodes: graph.nodes
      .filter((node) => !deleted.has(node.id))
      .map((node) => {
        const edit = edits.nodes[node.id]
        return edit ? { ...node, label: edit.label, note: edit.note } : node
      }),
    links: graph.links.filter(
      (link) => !deleted.has(link.source) && !deleted.has(link.target)
    ),
    activeId:
      graph.activeId && !deleted.has(graph.activeId) ? graph.activeId : null,
    latestId: latestVisible,
  }
}
