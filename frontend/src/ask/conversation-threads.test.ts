import { describe, expect, it } from "vitest"
import {
  conversationPath,
  conversationThreads,
  createConversationThreads,
} from "@/ask/conversation-threads"

function start() {
  let id = 0
  return createConversationThreads(() => ++id)
}
const page = {
  path: "/customers/C01?view=notes",
  title: "康泰客戶檔案",
  facts: ["客戶編號：C01"],
}

describe("分段對話與 Ghost mode", () => {
  it("開新對話保留舊內容，回到原對話後接續同一串", () => {
    const threads = start()
    const original = threads.getSnapshot().id
    threads
      .getSnapshot()
      .conversation.addUtterance("user", "typed", "客戶上次說了什麼？", {
        page,
      })
    threads.startNew()
    expect(threads.getSnapshot().conversation.getSnapshot()).toEqual([])
    expect(conversationThreads(threads.history.getSnapshot())).toMatchObject([
      { id: original, title: "客戶上次說了什麼？", page },
    ])
    expect(threads.resume(original)).toBe(true)
    threads.getSnapshot().conversation.addUtterance("user", "typed", "接著問")
    expect(conversationThreads(threads.history.getSnapshot())).toHaveLength(1)
    expect(threads.getSnapshot().conversation.getSnapshot()).toHaveLength(2)
  })

  it("Ghost 文字、語音與查詢不進歷史，離開後開啟空白的一般對話", () => {
    const threads = start()
    threads
      .getSnapshot()
      .conversation.addUtterance("user", "typed", "原本的對話")
    threads.enterGhost()
    const ghost = threads.getSnapshot().conversation
    ghost.addUtterance("user", "voice", "秘密")
    const id = ghost.addToolRun(null, "秘密查詢")
    ghost.completeWithMessage(id, "voice", "秘密回答")
    expect(ghost.getSnapshot().every((entry) => entry.ghost)).toBe(true)
    expect(threads.history.getSnapshot()).toHaveLength(1)
    const ghostId = threads.getSnapshot().id
    threads.enterGhost()
    expect(threads.getSnapshot().id).toBe(ghostId)
    threads.startNew()
    expect(threads.getSnapshot().ghost).toBe(false)
    expect(threads.getSnapshot().conversation.getSnapshot()).toEqual([])
    expect(threads.resume(ghostId)).toBe(false)
    // 遲到的語音內容仍留在原本的暫存 store，不能流入新的對話。
    ghost.addUtterance("model", "voice", "遲到的回答")
    expect(threads.history.getSnapshot()).toHaveLength(1)
  })

  it("跨裝置還原分段與時間，舊版無分段紀錄仍可繼續", () => {
    const threads = start()
    threads.history.merge([
      { id: 9, kind: "user", source: "typed", text: "舊版問題" },
      {
        id: 10,
        kind: "user",
        source: "typed",
        text: "新問題",
        threadId: "saved",
        createdAt: "2026-10-17T10:00:00Z",
        page,
      },
    ])
    threads.restoreLatest()
    expect(threads.getSnapshot().id).toBe("saved")
    expect(threads.getSnapshot().conversation.getSnapshot()).toHaveLength(1)
    expect(threads.resume("legacy")).toBe(true)
    expect(threads.getSnapshot().conversation.getSnapshot()[0].id).toBe(9)
  })

  it("歷史晚到時不覆蓋已經開啟的 Ghost mode", () => {
    const threads = start()
    threads.enterGhost()
    threads.history.merge([
      { id: 3, kind: "user", source: "typed", text: "歷史" },
    ])
    threads.restoreLatest()
    expect(threads.getSnapshot().ghost).toBe(true)
    expect(threads.getSnapshot().conversation.getSnapshot()).toEqual([])
  })

  it("回到原頁面時保留查詢參數，拒絕外部或登入回呼網址", () => {
    expect(conversationPath(page)).toBe(page.path)
    for (const path of [
      "//example.com",
      "/\\example.com",
      "https://example.com",
      "/auth/google/callback?code=secret",
      "/login",
    ]) {
      expect(conversationPath({ ...page, path })).toBe("/orders")
    }
  })
})
