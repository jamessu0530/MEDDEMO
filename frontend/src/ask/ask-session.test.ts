import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Ask } from "@/api/asks"
import type { AuthUser } from "@/lib/auth"

// 後端換成假的：createAsk 開一筆提問，getAsk 問進度
const api = vi.hoisted(() => ({ createAsk: vi.fn(), getAsk: vi.fn() }))
vi.mock("@/api/asks", () => ({
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  isFinished: (ask: Ask) => ask.status !== "queued" && ask.status !== "running",
}))

import { askSessionFor } from "@/ask/ask-session"
import { signIn, signOut } from "@/lib/auth"

const ask = (status: Ask["status"]) => ({ id: "a1", status, trace: [] }) as unknown as Ask
const user = (id: string) => ({ id, name: id, role: "sales", region: "北區", email: null }) as AuthUser

beforeEach(() => {
  vi.useFakeTimers()
  api.createAsk.mockReset()
  api.getAsk.mockReset()
})

afterEach(() => {
  signOut()
  vi.useRealTimers()
})

describe("askSessionFor", () => {
  it("切到別的頁面再回來，對話和查到一半的提問都還在，而且會查完", async () => {
    signIn({ token: "t", user: user("U01") })
    api.createAsk.mockResolvedValue(ask("queued"))
    api.getAsk.mockResolvedValueOnce(ask("running")).mockResolvedValue(ask("answered"))

    const session = askSessionFor("U01")
    const done = session.ask("data", "北區為什麼掉？")
    await vi.advanceTimersByTimeAsync(0)
    expect(session.isBusy()).toBe(true)

    // 問答頁卸載、切去促銷、再切回來：重新要一次，拿到的是同一段對話
    const back = askSessionFor("U01")
    expect(back).toBe(session)
    expect(back.conversation.getSnapshot().map((e) => e.kind)).toEqual(["user", "tool"])

    // 這段期間沒有人在看問答頁，輪詢照樣跑到有答案
    await vi.advanceTimersByTimeAsync(1100)
    await done
    const run = back.conversation.getSnapshot()[1]
    expect(run.kind === "tool" && run.ask?.status).toBe("answered")
    expect(session.isBusy()).toBe(false)
  })

  it("一次只送一題，送出中的狀態會通知畫面", async () => {
    signIn({ token: "t", user: user("U01") })
    api.createAsk.mockResolvedValue(ask("queued"))
    api.getAsk.mockResolvedValue(ask("answered"))
    const session = askSessionFor("U01")
    const changes: boolean[] = []
    session.subscribe(() => changes.push(session.isBusy()))

    const first = session.ask("data", "第一題")
    await session.ask("data", "還沒答完又送一題")
    expect(session.conversation.getSnapshot()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(600)
    await first
    expect(changes).toEqual([true, false])
  })

  it("送出失敗寫在那一格上，之後還能再問", async () => {
    signIn({ token: "t", user: user("U01") })
    api.createAsk.mockRejectedValue(new Error("這一小時的提問次數用完了"))
    const session = askSessionFor("U01")
    await session.ask("data", "北區為什麼掉？")
    const run = session.conversation.getSnapshot()[1]
    expect(run.kind === "tool" && run.error).toBe("這一小時的提問次數用完了")
    expect(session.isBusy()).toBe(false)
  })

  it("登出或換人登入就清掉：上一個人的提問不會留給下一個人，還在跑的輪詢也停掉", async () => {
    signIn({ token: "t", user: user("U01") })
    api.createAsk.mockResolvedValue(ask("queued"))
    api.getAsk.mockResolvedValue(ask("running"))
    const mine = askSessionFor("U01")
    void mine.ask("data", "我的客戶誰在拖款？")
    await vi.advanceTimersByTimeAsync(0)
    expect(mine.polls.aborted).toBe(false)

    signOut()
    expect(mine.polls.aborted).toBe(true)
    const asked = api.getAsk.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getAsk.mock.calls.length).toBe(asked)

    signIn({ token: "t2", user: user("U02") })
    const theirs = askSessionFor("U02")
    expect(theirs).not.toBe(mine)
    expect(theirs.conversation.getSnapshot()).toEqual([])

    // 同一個人登出再登入，也是從空的開始
    signOut()
    signIn({ token: "t3", user: user("U01") })
    expect(askSessionFor("U01").conversation.getSnapshot()).toEqual([])
  })
})
