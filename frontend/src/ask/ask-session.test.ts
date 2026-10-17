import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Ask } from "@/api/asks"
import type { AuthUser } from "@/lib/auth"
import type { ToolRun } from "@/ask/conversation"
import type { AskPageContext } from "@/ask/page-context"
const api = vi.hoisted(() => ({
  createAsk: vi.fn(),
  getAsk: vi.fn(),
  routeAsk: vi.fn(),
}))
vi.mock("@/api/asks", () => ({
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  routeAsk: api.routeAsk,
  isFinished: (ask: Ask) => ask.status !== "queued" && ask.status !== "running",
}))
import { askSessionFor } from "@/ask/ask-session"
import { signIn, signOut } from "@/lib/auth"
const user = (id: string) =>
  ({ id, name: id, role: "sales", region: "北區", email: null }) as AuthUser
const answer = (status: Ask["status"] = "answered") =>
  ({
    id: "a1",
    status,
    trace: [],
    answer: "近 90 天進貨減少",
  }) as unknown as Ask
const page = (): AskPageContext => ({
  path: "/customers/C01",
  title: "康泰 · 客戶檔案",
  facts: ["客戶：康泰", "客戶編號：C01"],
})
const routed = (question: string, extra = {}) => ({
  kind: "data",
  choices: [],
  confidence: 0.9,
  question,
  rewritten: false,
  ...extra,
})
const tools = (session: ReturnType<typeof askSessionFor>) =>
  session.conversation
    .getSnapshot()
    .filter((entry): entry is ToolRun => entry.kind === "tool")
beforeEach(() => {
  vi.useFakeTimers()
  api.createAsk.mockReset().mockResolvedValue(answer())
  api.getAsk.mockReset().mockResolvedValue(answer())
  api.routeAsk
    .mockReset()
    .mockImplementation(async (question: string) => routed(question))
  signIn({ token: "t", user: user("U01") })
})
afterEach(() => {
  signOut()
  vi.useRealTimers()
})
describe("全站自動問答", () => {
  it("操作求助先邀請示範，不查詢或自動操作", async () => {
    const session = askSessionFor("U01")
    await session.ask("我不會新增訂單，可以教我嗎？", undefined, page())
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user" },
      { kind: "model", demo: "create-order" },
    ])
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("自動判斷，頁面快照不隨切頁或外部修改改變", async () => {
    let decide: (value: unknown) => void = () => {}
    api.routeAsk.mockReturnValue(
      new Promise((resolve) => {
        decide = resolve
      })
    )
    const context = page(),
      snapshot = page(),
      session = askSessionFor("U01")
    const done = session.ask("他多久沒進貨？", undefined, context)
    context.title = "另一位客戶"
    context.facts[0] = "客戶：另一家"
    expect(session.isBusy()).toBe(true)
    expect(api.routeAsk).toHaveBeenCalledWith(
      "他多久沒進貨？",
      false,
      [],
      snapshot
    )
    decide(routed("康泰多久沒進貨？", { rewritten: true, context_used: true }))
    await done
    expect(api.createAsk).toHaveBeenCalledWith(
      "data",
      "康泰多久沒進貨？",
      undefined
    )
    expect(tools(session)[0]).toMatchObject({
      page: snapshot,
      contextUsed: true,
      original: "他多久沒進貨？",
      auto: true,
    })
  })
  it("跨頁問題原句照查，自動改用文件來源", async () => {
    api.routeAsk.mockResolvedValue(
      routed("公司的退貨規定是什麼？", { kind: "knowledge" })
    )
    const session = askSessionFor("U01")
    await session.ask("公司的退貨規定是什麼？", undefined, page())
    expect(api.createAsk).toHaveBeenCalledWith(
      "knowledge",
      "公司的退貨規定是什麼？",
      undefined
    )
    expect(tools(session)[0].contextUsed).toBe(false)
  })
  it("切頁或收起，未完成查詢繼續保留；一次只送一題", async () => {
    api.createAsk.mockResolvedValue(answer("queued"))
    api.getAsk
      .mockResolvedValueOnce(answer("running"))
      .mockResolvedValue(answer())
    const session = askSessionFor("U01")
    const states: boolean[] = []
    session.subscribe(() => states.push(session.isBusy()))
    const done = session.ask("康泰最近如何？", undefined, page())
    await session.ask("連按第二題")
    await vi.advanceTimersByTimeAsync(0)
    expect(askSessionFor("U01")).toBe(session)
    expect(session.isBusy()).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    await done
    expect(tools(session)[0].ask?.status).toBe("answered")
    expect(api.routeAsk).toHaveBeenCalledTimes(1)
    expect(states).toEqual([true, false])
  })
  it("自然追問的補充會帶原問題、原頁面與附檔", async () => {
    api.routeAsk.mockResolvedValueOnce(
      routed("這個怎麼樣？", {
        kind: null,
        clarification: "想問進貨還是拜訪狀況？",
      })
    )
    const session = askSessionFor("U01"),
      photo = new File(["x"], "box.jpg", { type: "image/jpeg" })
    await session.ask("這個怎麼樣？", photo, page())
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(tools(session)[0]).toMatchObject({
      clarification: "想問進貨還是拜訪狀況？",
      choices: null,
    })
    const elsewhere = { path: "/reports", title: "報表", facts: [] }
    api.routeAsk.mockResolvedValueOnce(
      routed("康泰進貨狀況", { continues_previous: true })
    )
    await session.ask("進貨狀況", undefined, elsewhere)
    expect(api.routeAsk).toHaveBeenLastCalledWith(
      "進貨狀況",
      false,
      [
        {
          question: "這個怎麼樣？",
          answer: "想問進貨還是拜訪狀況？",
          page: page(),
          has_file: true,
        },
      ],
      elsewhere
    )
    expect(api.createAsk).toHaveBeenCalledWith("data", "康泰進貨狀況", photo)
  })
  it("追問時改問獨立問題，不把前題附檔帶進新查詢", async () => {
    const session = askSessionFor("U01"),
      photo = new File(["x"], "box.jpg", { type: "image/jpeg" })
    api.routeAsk.mockResolvedValueOnce(
      routed("這個怎麼樣？", { kind: null, clarification: "你想了解什麼？" })
    )
    await session.ask("這個怎麼樣？", photo, page())
    api.routeAsk.mockResolvedValueOnce(
      routed("公司的退貨規定？", {
        kind: "knowledge",
        continues_previous: false,
      })
    )
    await session.ask("公司的退貨規定？", undefined, page())
    expect(api.createAsk).toHaveBeenLastCalledWith(
      "knowledge",
      "公司的退貨規定？",
      undefined
    )
  })
  it("整理失敗顯示錯誤並可重問，不默認數字或要求選模式", async () => {
    api.routeAsk.mockRejectedValueOnce(new Error("伺服器暫時沒有回應"))
    const session = askSessionFor("U01")
    await session.ask("北區為什麼掉？")
    expect(tools(session)[0]).toMatchObject({
      choices: null,
      routing: false,
      error: "伺服器暫時沒有回應",
    })
    expect(api.createAsk).not.toHaveBeenCalled()
    await session.ask("北區為什麼掉？")
    expect(api.createAsk).toHaveBeenCalledTimes(1)
  })
  it("追問帶答完的對話與各題原始頁面", async () => {
    const session = askSessionFor("U01")
    await session.ask("康泰進貨如何？", undefined, page())
    await session.ask("那上一季呢？", undefined, {
      path: "/reports",
      title: "報表",
      facts: [],
    })
    expect(api.routeAsk.mock.calls[1][2]).toEqual([
      { question: "康泰進貨如何？", answer: "近 90 天進貨減少", page: page() },
    ])
  })
  it("照原話查另開一格，保留原題與頁面", async () => {
    api.routeAsk.mockResolvedValue(
      routed("康泰進貨如何？", { rewritten: true, context_used: true })
    )
    const session = askSessionFor("U01")
    await session.ask("他如何？", undefined, page())
    await session.askAsTyped(tools(session)[0].id)
    expect(api.createAsk).toHaveBeenLastCalledWith(
      "data",
      "他如何？",
      undefined
    )
    expect(tools(session)[1]).toMatchObject({
      page: page(),
      question: "他如何？",
    })
  })
  it("登出中止查詢，遲到的分流不替下一個帳號送出", async () => {
    let decide: (value: unknown) => void = () => {}
    api.routeAsk.mockReturnValue(
      new Promise((resolve) => {
        decide = resolve
      })
    )
    const first = askSessionFor("U01"),
      done = first.ask("第一人的問題", undefined, page())
    signOut()
    signIn({ token: "next", user: user("U02") })
    const second = askSessionFor("U02")
    decide(routed("第一人的問題"))
    await done
    expect(first.polls.aborted).toBe(true)
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(second.conversation.getSnapshot()).toEqual([])
  })
  it("記憶地圖跨頁保留，換帳號清空", () => {
    const first = askSessionFor("U01")
    first.mapEdits.edit("question:1", "我的問題", "待辦筆記")
    expect(askSessionFor("U01").mapEdits.getSnapshot()).toEqual(
      first.mapEdits.getSnapshot()
    )
    signIn({ token: "next", user: user("U02") })
    expect(askSessionFor("U02").mapEdits.getSnapshot()).toEqual({
      nodes: {},
      deleted: [],
    })
  })
})
