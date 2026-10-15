import { describe, expect, it, vi } from "vitest"
import { createConversation } from "@/ask/conversation"
import { buildMemoryMap, filterMemoryMap } from "@/ask/memory-map"
import { applyMapEdits, createMapEditsStore } from "@/ask/memory-map-edits"

function graph() {
  const conversation = createConversation()
  conversation.addToolRun("knowledge", "退貨怎麼處理？")
  return { conversation, map: buildMemoryMap(conversation.getSnapshot()) }
}

describe("editable memory map", () => {
  it("改名稱與筆記保留查詢原文，後續進度更新也保留編輯", () => {
    const { conversation, map } = graph()
    const store = createMapEditsStore()
    store.edit("question:1", "  退貨流程  ", " 下週和主管確認 ")
    const edited = applyMapEdits(map, store.getSnapshot())
    const node = edited.nodes.find((node) => node.id === "question:1")!
    expect(node.label).toBe("退貨流程")
    expect(node.note).toBe("下週和主管確認")
    expect(node.detail).toBe("退貨怎麼處理？")
    expect(map.nodes.find((node) => node.id === "question:1")?.label).toBe(
      "退貨怎麼處理？"
    )
    conversation.replace(1, { error: "暫時無法查詢" })
    const refreshed = applyMapEdits(
      buildMemoryMap(conversation.getSnapshot()),
      store.getSnapshot()
    )
    expect(
      refreshed.nodes.find((node) => node.id === "question:1")?.label
    ).toBe("退貨流程")
    expect(refreshed.nodes.find((node) => node.id === "question:1")?.meta).toBe(
      "查詢失敗"
    )
    expect(
      filterMemoryMap(edited, "all", "下週和主管確認").nodes.some(
        (node) => node.id === "question:1"
      )
    ).toBe(true)
  })

  it("刪除只移除地圖節點與連線，復原會保留名稱與筆記", () => {
    const { conversation, map } = graph()
    const store = createMapEditsStore()
    store.edit("question:1", "退貨流程", "待確認")
    store.remove("question:1")
    const deleted = applyMapEdits(map, store.getSnapshot())
    expect(deleted.nodes.some((node) => node.id === "question:1")).toBe(false)
    expect(
      deleted.links.some(
        (link) => link.target === "question:1" || link.source === "question:1"
      )
    ).toBe(false)
    expect(deleted.activeId).toBeNull()
    expect(conversation.getSnapshot()).toHaveLength(1)
    store.restore("question:1")
    const restored = applyMapEdits(map, store.getSnapshot())
    expect(restored.nodes.find((node) => node.id === "question:1")?.note).toBe(
      "待確認"
    )
    expect(restored.links).toEqual(map.links)
  })

  it("訂閱快照穩定、空名稱不提交、重複刪除不重送通知", () => {
    const store = createMapEditsStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const before = store.getSnapshot()
    store.edit("a", "  ", "ignored")
    expect(store.getSnapshot()).toBe(before)
    store.remove("a")
    store.remove("a")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().deleted).toEqual(["a"])
    unsubscribe()
    store.restore()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("可分別復原或全部復原，新的對話不沿用之前的編輯", () => {
    const first = createMapEditsStore()
    first.edit("a", "標題", "筆記")
    first.remove("a")
    first.remove("b")
    first.restore("a")
    expect(first.getSnapshot().deleted).toEqual(["b"])
    first.restore()
    expect(first.getSnapshot().deleted).toEqual([])
    expect(createMapEditsStore().getSnapshot()).toEqual({
      nodes: {},
      deleted: [],
    })
  })

  it("刪除分類節點後，分類篩選仍可查看該類的問題", () => {
    const { map } = graph()
    const store = createMapEditsStore()
    store.remove("topic:knowledge")
    const filtered = filterMemoryMap(
      applyMapEdits(map, store.getSnapshot()),
      "knowledge",
      ""
    )
    expect(filtered.nodes.some((node) => node.id === "question:1")).toBe(true)
    expect(filtered.nodes.some((node) => node.id === "topic:knowledge")).toBe(
      false
    )
  })
})
