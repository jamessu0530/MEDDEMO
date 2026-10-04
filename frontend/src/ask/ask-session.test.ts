import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Ask } from "@/api/asks"
import type { AuthUser } from "@/lib/auth"

// 後端換成假的：routeAsk 判斷該查哪一種，createAsk 開一筆提問，getAsk 問進度
const api = vi.hoisted(() => ({ createAsk: vi.fn(), getAsk: vi.fn(), routeAsk: vi.fn() }))
vi.mock("@/api/asks", () => ({
  ASK_KINDS: ["data", "knowledge", "memory"],
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  routeAsk: api.routeAsk,
  isFinished: (ask: Ask) => ask.status !== "queued" && ask.status !== "running",
}))

import type { ToolRun } from "@/ask/conversation"
import { askSessionFor } from "@/ask/ask-session"
import { signIn, signOut } from "@/lib/auth"

const ask = (status: Ask["status"]) => ({ id: "a1", status, trace: [] }) as unknown as Ask
const user = (id: string) => ({ id, name: id, role: "sales", region: "北區", email: null }) as AuthUser
const tools = (session: ReturnType<typeof askSessionFor>) =>
  session.conversation.getSnapshot().filter((entry): entry is ToolRun => entry.kind === "tool")

beforeEach(() => {
  vi.useFakeTimers()
  api.createAsk.mockReset()
  api.getAsk.mockReset()
  api.routeAsk.mockReset()
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

  it("選自動：判斷時那一格寫著在判斷，有把握就直接查那一種並標成自動判斷", async () => {
    signIn({ token: "t", user: user("U01") })
    let decide: (value: unknown) => void = () => {}
    api.routeAsk.mockReturnValue(new Promise((resolve) => (decide = resolve)))
    api.createAsk.mockResolvedValue(ask("answered"))
    const session = askSessionFor("U01")

    const done = session.ask("auto", "北區還有哪些待辦沒做完？")
    await vi.advanceTimersByTimeAsync(0)
    expect(session.isBusy()).toBe(true)
    expect(tools(session)[0]).toMatchObject({ routing: true, askKind: null })
    expect(api.routeAsk).toHaveBeenCalledWith("北區還有哪些待辦沒做完？", false)

    decide({ kind: "memory", choices: [], confidence: 0.99 })
    await done
    expect(api.createAsk).toHaveBeenCalledWith("memory", "北區還有哪些待辦沒做完？", undefined)
    expect(tools(session)[0]).toMatchObject({ routing: false, askKind: "memory", auto: true, choices: null })
    expect(session.isBusy()).toBe(false)
  })

  it("沒把握就列出選項等業務點，點了在同一格查，附的檔案也一起送", async () => {
    signIn({ token: "t", user: user("U01") })
    api.routeAsk.mockResolvedValue({ kind: null, choices: ["data", "memory"], confidence: 0.3 })
    api.createAsk.mockResolvedValue(ask("answered"))
    const session = askSessionFor("U01")
    const photo = new File(["x"], "box.jpg", { type: "image/jpeg" })

    await session.ask("auto", "康泰忠孝店最近怎麼樣？", photo)
    expect(api.routeAsk).toHaveBeenCalledWith("康泰忠孝店最近怎麼樣？", true)
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(session.isBusy()).toBe(false)
    const [waiting] = tools(session)
    expect(waiting).toMatchObject({ routing: false, choices: ["data", "memory"], askKind: null })

    await session.choose(waiting.id, "memory")
    expect(api.createAsk).toHaveBeenCalledWith("memory", "康泰忠孝店最近怎麼樣？", photo)
    expect(tools(session)).toHaveLength(1)
    expect(tools(session)[0]).toMatchObject({ choices: null, askKind: "memory", auto: false })
  })

  it("判斷失敗不擋：三種都列出來請業務選", async () => {
    signIn({ token: "t", user: user("U01") })
    api.routeAsk.mockRejectedValue(new Error("伺服器暫時沒有回應，請再試一次"))
    const session = askSessionFor("U01")
    await session.ask("auto", "北區為什麼掉？")
    expect(tools(session)[0]).toMatchObject({ choices: ["data", "knowledge", "memory"], error: null })
    expect(session.isBusy()).toBe(false)
  })

  it("自動判斷查完想換一種：另開一格重查，原本那格留著", async () => {
    signIn({ token: "t", user: user("U01") })
    api.routeAsk.mockResolvedValue({ kind: "data", choices: [], confidence: 0.8 })
    api.createAsk.mockResolvedValue(ask("answered"))
    const session = askSessionFor("U01")
    await session.ask("auto", "補貨現在多久補一次？")

    await session.choose(tools(session)[0].id, "knowledge")
    expect(api.createAsk).toHaveBeenLastCalledWith("knowledge", "補貨現在多久補一次？", undefined)
    expect(tools(session).map((run) => [run.askKind, run.auto])).toEqual([
      ["data", true],
      ["knowledge", false],
    ])
    // 業務那句話只有一句，重查不會再多一句
    expect(session.conversation.getSnapshot().filter((entry) => entry.kind === "user")).toHaveLength(1)
  })

  it("自己指定種類就不判斷", async () => {
    signIn({ token: "t", user: user("U01") })
    api.createAsk.mockResolvedValue(ask("answered"))
    const session = askSessionFor("U01")
    await session.ask("knowledge", "近效期的貨要多久前申請退貨？")
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(tools(session)[0]).toMatchObject({ askKind: "knowledge", auto: false })
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
