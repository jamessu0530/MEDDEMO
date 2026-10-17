import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountMemory } from "@/api/assistant-memory"
import type { Entry } from "@/ask/conversation"
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock("@/api/assistant-memory", () => ({
  getAccountMemory: api.get,
  saveAccountMemory: api.save,
}))
import { createConversation } from "@/ask/conversation"
import { createMapEditsStore } from "@/ask/memory-map-edits"
import { syncAccountMemory } from "@/ask/memory-sync"

const controllers: ReturnType<typeof syncAccountMemory>[] = []
function start(id = "U01", token = "first-token") {
  const conversation = createConversation(),
    edits = createMapEditsStore()
  const sync = syncAccountMemory(id, token, conversation, edits)
  controllers.push(sync)
  return { conversation, edits, sync }
}
beforeEach(() => {
  vi.useFakeTimers()
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  api.get.mockReset().mockResolvedValue({ entries: [], nodes: [] })
  api.save.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const sync of controllers.splice(0)) sync.stop()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("帳號長期記憶", () => {
  it("重新登入還原對話、筆記與隱藏狀態，不把讀到的歷史重新覆蓋上傳", async () => {
    const entries: Entry[] = [
      { id: 9, kind: "user", source: "typed", text: "退貨流程？" },
    ]
    api.get.mockResolvedValue({
      entries,
      nodes: [
        { id: "question:10", label: "退貨", note: "下週確認", deleted: true },
      ],
    })
    const { conversation, edits, sync } = start()
    await sync.ready
    expect(conversation.getSnapshot()).toEqual(entries)
    expect(edits.getSnapshot()).toEqual({
      nodes: { "question:10": { label: "退貨", note: "下週確認" } },
      deleted: ["question:10"],
    })
    expect(api.save).not.toHaveBeenCalled()
    expect(sync.getSnapshot()).toBe("saved")
  })

  it("斷線後登出保留待同步資料，下次同帳號登入補送；其他帳號讀不到", async () => {
    const first = start()
    await first.sync.ready
    api.save.mockRejectedValue(new Error("offline"))
    first.conversation.addUtterance("user", "typed", "私人問題")
    first.edits.edit("question:2", "筆記", "私人重點")
    await expect(first.sync.flush()).rejects.toThrow("offline")
    first.sync.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(localStorage.getItem("meddemo:memory-outbox:U01")).toContain(
      "私人重點"
    )
    const other = start("U02", "other-token")
    await other.sync.ready
    expect(other.conversation.getSnapshot()).toEqual([])
    api.save.mockResolvedValue(undefined)
    const again = start("U01", "new-token")
    await again.sync.ready
    expect(again.conversation.getSnapshot()[0]).toMatchObject({
      text: "私人問題",
    })
    expect(again.edits.getSnapshot().nodes["question:2"].note).toBe("私人重點")
    expect(api.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ text: "私人問題" })],
      }),
      "new-token",
      false
    )
    expect(localStorage.getItem("meddemo:memory-outbox:U01")).toBeNull()
  })

  it("歷史載入較慢時保留新提問與已同步的本機筆記", async () => {
    let resolve!: (memory: AccountMemory) => void
    api.get.mockReturnValue(
      new Promise<AccountMemory>((done) => {
        resolve = done
      })
    )
    const { conversation, edits, sync } = start()
    conversation.addUtterance("user", "typed", "新問題")
    edits.edit("conversation", "我的地圖", "新筆記")
    await sync.flush()
    resolve({
      entries: [{ id: -1, kind: "model", source: "typed", text: "舊答案" }],
      nodes: [],
    })
    await sync.ready
    expect(
      conversation
        .getSnapshot()
        .map((entry) => (entry.kind === "tool" ? "" : entry.text))
    ).toEqual(["舊答案", "新問題"])
    expect(edits.getSnapshot().nodes.conversation.note).toBe("新筆記")
  })

  it("保存進行中新增的變更會接續送出，復原也會保存 deleted=false", async () => {
    const { edits, sync } = start()
    await sync.ready
    let resolve!: () => void
    api.save.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done
      })
    )
    edits.remove("a")
    const saving = sync.flush()
    edits.restore("a")
    resolve()
    await saving
    expect(api.save.mock.calls.map((call) => call[0].nodes)).toEqual([
      [{ id: "a", deleted: true }],
      [{ id: "a", deleted: false }],
    ])
  })

  it("登出後到達的歷史不會填入另一人的畫面，寫入仍使用原帳號 token", async () => {
    let resolve!: (memory: AccountMemory) => void
    api.get.mockReturnValueOnce(
      new Promise<AccountMemory>((done) => {
        resolve = done
      })
    )
    const first = start()
    first.conversation.addUtterance("user", "typed", "第一人的問題")
    first.sync.stop()
    const other = start("U02", "other-token")
    await other.sync.ready
    resolve({
      entries: [{ id: -2, kind: "model", source: "typed", text: "私人歷史" }],
      nodes: [],
    })
    await first.sync.ready
    expect(other.conversation.getSnapshot()).toEqual([])
    expect(first.conversation.getSnapshot()).toHaveLength(1)
    expect(api.save).toHaveBeenCalledWith(
      expect.anything(),
      "first-token",
      true
    )
  })

  it("歷史讀取失敗後，即使新資料保存成功，仍顯示可重試的狀態", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"))
    const { conversation, sync } = start()
    await sync.ready
    conversation.addUtterance("user", "typed", "新的問題")
    await sync.flush()
    expect(sync.getSnapshot()).toBe("error")
    await sync.retry()
    expect(sync.getSnapshot()).toBe("saved")
  })
})
