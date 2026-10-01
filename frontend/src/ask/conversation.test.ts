import { describe, expect, it, vi } from "vitest"

import { createConversation, type Entry } from "@/ask/conversation"

/** 測試用的最小 Ask；store 不看裡面的內容，只負責原樣放進 ToolRun */
const ask = (id: string) => ({ id }) as unknown as import("@/api/asks").Ask

describe("conversation", () => {
  it("依序附加，id 不重複", () => {
    const c = createConversation()
    const a = c.addUtterance("user", "typed", "北區為什麼掉？")
    const b = c.addToolRun("data", "北區為什麼掉？")
    expect(a).not.toBe(b)
    expect(c.getSnapshot().map((e) => e.id)).toEqual([a, b])
  })

  it("語音與打字的 entry 交錯後順序正確", () => {
    const c = createConversation()
    // 打字問一題（user + tool），再用講的問一題（user + model）
    c.addUtterance("user", "typed", "北區為什麼掉？")
    c.addToolRun("data", "北區為什麼掉？")
    c.addUtterance("user", "voice", "那康泰呢？")
    c.addUtterance("model", "voice", "康泰這一季…")
    expect(c.getSnapshot().map((e) => [e.kind, e.kind === "tool" ? "tool" : e.source])).toEqual([
      ["user", "typed"],
      ["tool", "tool"],
      ["user", "voice"],
      ["model", "voice"],
    ])
  })

  it("appendText 累加並整理中文字之間的空白", () => {
    const c = createConversation()
    const id = c.addUtterance("model", "voice", "")
    c.appendText(id, "近效期 品項")
    c.appendText(id, " 退貨")
    const entry = c.getSnapshot()[0]
    expect(entry.kind === "model" && entry.text).toBe("近效期品項退貨")
  })

  it("replace 只換掉指定的 ToolRun，不動其他 entry", () => {
    const c = createConversation()
    const first = c.addToolRun("data", "第一題")
    const second = c.addToolRun("data", "第二題")
    c.replace(second, { ask: ask("A2") })
    const [one, two] = c.getSnapshot() as [Entry, Entry]
    expect(one.id).toBe(first)
    expect(one.kind === "tool" && one.ask).toBeNull()
    expect(two.kind === "tool" && two.ask?.id).toBe("A2")
  })

  it("replace 對不存在的 id 是 no-op，不丟例外", () => {
    // 對話結束後遲到的輪詢結果不能讓畫面炸掉
    const c = createConversation()
    const id = c.addToolRun("data", "第一題")
    const before = c.getSnapshot()
    expect(() => c.replace(id + 999, { ask: ask("A9") })).not.toThrow()
    expect(c.getSnapshot()).toBe(before)
  })

  it("replace 用在 Utterance 的 id 上也是 no-op", () => {
    const c = createConversation()
    const id = c.addUtterance("user", "typed", "問題")
    const before = c.getSnapshot()
    c.replace(id, { ask: ask("A9") })
    expect(c.getSnapshot()).toBe(before)
  })

  it("add 與 replace 都通知訂閱者，取消訂閱之後不再通知", () => {
    const c = createConversation()
    const listener = vi.fn()
    const unsubscribe = c.subscribe(listener)
    const id = c.addToolRun("data", "第一題")
    expect(listener).toHaveBeenCalledTimes(1)
    c.replace(id, { ask: ask("A1") })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    c.addUtterance("user", "typed", "再一題")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("沒有變動時 getSnapshot 回傳同一個參考", () => {
    // 每次回傳新陣列會讓 useSyncExternalStore 無限重繪
    const c = createConversation()
    c.addUtterance("user", "typed", "問題")
    expect(c.getSnapshot()).toBe(c.getSnapshot())
  })

  it("打字提問的附件掛在那一句上，掛不到工具卡或 AI 的話", () => {
    const c = createConversation()
    const user = c.addUtterance("user", "typed", "這個上個月賣多少")
    const tool = c.addToolRun("data", "這個上個月賣多少")
    const model = c.addUtterance("model", "voice", "好")
    const file = { id: 7, kind: "image", filename: "box.jpg" } as unknown as import("@/api/attachments").Attachment
    c.attach(user, file)
    c.attach(tool, file)
    c.attach(model, file)
    const [first, second, third] = c.getSnapshot() as Entry[]
    expect(first.kind === "user" && first.attachment).toBe(file)
    expect("attachment" in second).toBe(false)
    expect(third.kind === "model" && third.attachment).toBeFalsy()
  })
})
