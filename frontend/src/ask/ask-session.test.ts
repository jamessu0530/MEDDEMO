import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Ask } from "@/api/asks"
import type { AuthUser } from "@/lib/auth"
import type { ToolRun } from "@/ask/conversation"
import type { AskPageContext } from "@/ask/page-context"
const api = vi.hoisted(() => ({
  createAsk: vi.fn(),
  getAsk: vi.fn(),
  routeAsk: vi.fn(),
  adjustReport: vi.fn(),
  askPriorityAdvice: vi.fn(),
  getAccountMemory: vi.fn(),
  saveAccountMemory: vi.fn(),
  planTasks: vi.fn(),
}))
vi.mock("@/api/assistant-tasks", () => ({
  planAssistantTasks: api.planTasks,
  executeAssistantTask: vi.fn(),
  controlRouteOrders: vi.fn(),
  TASK_CAPABILITIES: ["report.create", "order.create", "data.query", "knowledge.query", "memory.query", "page.open"],
  TASK_PAGES: ["/reports", "/orders", "/calendar"],
}))
vi.mock("@/api/reports", () => ({ adjustReport: api.adjustReport }))
vi.mock("@/api/assistant-memory", () => ({
  getAccountMemory: api.getAccountMemory,
  saveAccountMemory: api.saveAccountMemory,
}))
vi.mock("@/api/customer-priority", () => ({
  askPriorityAdvice: api.askPriorityAdvice,
}))
vi.mock("@/api/asks", () => ({
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  routeAsk: api.routeAsk,
  isFinished: (ask: Ask) => ask.status !== "queued" && ask.status !== "running",
}))
import { askSessionFor } from "@/ask/ask-session"
import { signIn, signOut } from "@/lib/auth"
import { reportAssistant } from "@/ask/report-assistant"
import { customerPriorityAssistant } from "@/ask/customer-priority-assistant"
import type { ReportConfig } from "@/lib/reports"
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
  api.planTasks.mockReset().mockResolvedValue({ handled: false, message: "", commands: [] })
  api.createAsk.mockReset().mockResolvedValue(answer())
  api.getAccountMemory.mockReset().mockResolvedValue({ entries: [], nodes: [] })
  api.saveAccountMemory.mockReset().mockResolvedValue(undefined)
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
  it("Ghost 查詢送出隱私標記，不同步到帳號；新對話不帶前文", async () => {
    const session = askSessionFor("U01")
    await session.memory?.ready
    await session.ask("原本的問題", undefined, page())
    await session.memory?.flush()
    const saves = api.saveAccountMemory.mock.calls.length
    const saved = session.threads.history.getSnapshot()
    session.threads.enterGhost()
    await session.ask("暫時問的問題", undefined, page())
    expect(api.createAsk).toHaveBeenLastCalledWith("data", "暫時問的問題", undefined, true)
    expect(session.threads.history.getSnapshot()).toBe(saved)
    expect(api.routeAsk.mock.calls.at(-1)?.[2]).toEqual([])
    await session.memory?.flush()
    expect(api.saveAccountMemory).toHaveBeenCalledTimes(saves)
    session.threads.startNew()
    await session.ask("新問題", undefined, page())
    expect(api.routeAsk.mock.calls.at(-1)?.[2]).toEqual([])
    expect(session.conversation.getSnapshot()).toHaveLength(2)
    expect(session.threads.history.getSnapshot().some((entry) => entry.ghost)).toBe(false)
  })
  it("切換對話後才到達的 Ghost 追問，不把原附件帶進新的正常對話", async () => {
    const session = askSessionFor("U01")
    await session.memory?.ready
    session.threads.enterGhost()
    let finish!: (value: ReturnType<typeof routed>) => void
    api.routeAsk.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = session.ask("暫時問這張照片", new File(["private"], "private.jpg"), page())
    session.threads.startNew()
    finish(routed("暫時問這張照片", { kind: null, clarification: "想問哪一部分？" }))
    await pending
    api.routeAsk.mockResolvedValueOnce(routed("新的問題", { continues_previous: true }))
    await session.ask("新的問題", undefined, page())
    expect(api.createAsk).toHaveBeenLastCalledWith("data", "新的問題", undefined, false, { page: page(), contextUsed: false })
  })
  it("重新登入後接續輪詢舊查詢，不再次建立提問", async () => {
    const restored = { id: 777, kind: "tool", question: "之前的問題", askKind: "data", ask: answer("running"), original: null, error: null, routing: false, cancelled: false, choices: null, auto: true }
    api.getAccountMemory.mockResolvedValue({ entries: [restored], nodes: [] })
    const session = askSessionFor("U01")
    await session.memory?.ready
    await vi.advanceTimersByTimeAsync(500)
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(api.getAsk).toHaveBeenCalledOnce()
    expect(tools(session)[0].ask?.status).toBe("answered")
  })

  it("還原的問題仍可照原話查，原附件會重新讀取後送出", async () => {
    const restored = { id: 778, kind: "tool", question: "改寫過的問題", askKind: "data", ask: { ...answer(), attachment: { url: "/api/attachments/8?sig=fresh", filename: "box.jpg" } }, original: "原話", error: null, routing: false, cancelled: false, choices: null, auto: true, hasFile: true }
    api.getAccountMemory.mockResolvedValue({ entries: [restored], nodes: [] })
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/jpeg" })))
    vi.stubGlobal("fetch", fetch)
    try {
      const session = askSessionFor("U01")
      await session.memory?.ready
      await session.askAsTyped(778)
      expect(fetch).toHaveBeenCalledWith("/api/attachments/8?sig=fresh", expect.objectContaining({ signal: expect.any(AbortSignal) }))
      expect(api.createAsk).toHaveBeenCalledWith("data", "原話", expect.objectContaining({ name: "box.jpg", type: "image/jpeg" }))
    } finally { vi.unstubAllGlobals() }
  })
  it("客戶策略從共用對話取得建議，一般營收查詢仍照原流程", async () => {
    const strategy = {
      id: "balanced",
      name: "均衡經營",
      days: 90,
      daily_limit: 5,
      metrics: [
        { metric: "revenue" as const, weight: 1, direction: "higher" as const },
      ],
      priority_customers: [],
    }
    const context = {
      path: "/manager?view=priority",
      title: "客戶策略",
      facts: [],
    }
    const onUse = vi.fn()
    customerPriorityAssistant.connect({
      managerId: "M01",
      strategy,
      disabled: false,
      onUse,
    })
    api.askPriorityAdvice.mockResolvedValueOnce({
      message: "已提出建議。",
      strategy,
      source: "ai",
    })
    const session = askSessionFor("U01")
    await session.ask("幫我調整指標權重", undefined, context)
    expect(api.askPriorityAdvice).toHaveBeenCalledWith(
      "M01",
      strategy,
      "幫我調整指標權重",
      [],
      undefined,
      expect.any(AbortSignal)
    )
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user", text: "幫我調整指標權重", page: context },
      { kind: "model", text: "已提出建議。", page: context },
    ])
    expect(onUse).not.toHaveBeenCalled()
    await session.ask("團隊營收多少？", undefined, context)
    expect(api.routeAsk).toHaveBeenCalledOnce()
    customerPriorityAssistant.apply()
    expect(onUse).toHaveBeenCalledOnce()
  })
  it("報表調整從共用對話送出，預覽確認後才更新報表", async () => {
    const config: ReportConfig = {
      name: "業績",
      template: "sales",
      period: "this_month",
      owner_id: null,
      customer_type: null,
      cards: [],
    }
    const proposed = { ...config, name: "新版業績" }
    api.adjustReport.mockResolvedValueOnce({
      kind: "proposal",
      message: "已修改名稱。",
      config: proposed,
    })
    const onApply = vi.fn()
    reportAssistant.connect({ config, available: true, onApply })
    const session = askSessionFor("U01")
    await session.ask("修改報表名稱", undefined, {
      path: "/reports",
      title: "業績",
      facts: [],
    })
    expect(api.adjustReport).toHaveBeenCalledWith(
      "修改報表名稱",
      config,
      expect.any(AbortSignal)
    )
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user", text: "修改報表名稱" },
      { kind: "model", text: "已修改名稱。" },
    ])
    expect(onApply).not.toHaveBeenCalled()
    reportAssistant.apply()
    expect(onApply).toHaveBeenCalledExactlyOnceWith(proposed)
  })
  it.each([
    "這個頁面可以幹嘛？",
    "可以跟我講一下如何設定這個頁面嗎",
    "請說明這個頁面怎麼用",
    "不用示範，介紹日曆功能就好",
  ])("頁面說明直接顯示回覆，不查文件或自動示範：%s", async (question) => {
    const context = { path: "/calendar", title: "日曆", facts: [] }
    api.routeAsk.mockResolvedValueOnce(
      routed(question, {
        kind: null,
        intent: "page_help",
        answer: "按右上角齒輪「日曆與設定」管理分類、共享與通知。",
        context_used: true,
      })
    )
    const session = askSessionFor("U01")
    await session.ask(question, undefined, context)
    expect(api.routeAsk).toHaveBeenCalledWith(question, false, [], context)
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user", text: question },
      {
        kind: "model",
        text: expect.stringContaining("日曆與設定"),
        page: context,
      },
    ])
    expect(session.conversation.getSnapshot()[1]).not.toHaveProperty("demo")
    expect(tools(session)).toHaveLength(0)
    expect(session.isBusy()).toBe(false)
    await session.ask("那通知呢？", undefined, context)
    expect(api.routeAsk.mock.calls[1][2]).toEqual([
      {
        question,
        answer: "按右上角齒輪「日曆與設定」管理分類、共享與通知。",
        page: context,
      },
    ])
  })
  it("後端辨識的示範使用登錄頁面，保留一般回覆順序", async () => {
    api.routeAsk.mockResolvedValueOnce(
      routed("帶我一步一步逛日曆", {
        kind: null,
        intent: "page_demo",
        answer: "日曆可新增行程。",
        demo_path: "/calendar?view=week",
      })
    )
    const session = askSessionFor("U01")
    await session.ask("帶我一步一步逛日曆", undefined, page())
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user" },
      { kind: "model", demo: "page-tour", demoPath: "/calendar?view=week" },
    ])
    expect(api.createAsk).not.toHaveBeenCalled()
    expect(tools(session)).toHaveLength(0)
  })
  it("資料與公司規定問題仍執行查詢", async () => {
    const context = { path: "/calendar", title: "日曆", facts: [] }
    const session = askSessionFor("U01")
    await session.ask("今天有幾個行程？", undefined, context)
    api.routeAsk.mockResolvedValueOnce(
      routed("公司的共享日曆規定是什麼？", { kind: "knowledge" })
    )
    await session.ask("公司的共享日曆規定是什麼？", undefined, context)
    expect(api.createAsk).toHaveBeenNthCalledWith(
      1,
      "data",
      "今天有幾個行程？",
      undefined, false, { page: context, contextUsed: false }
    )
    expect(api.createAsk).toHaveBeenNthCalledWith(
      2,
      "knowledge",
      "公司的共享日曆規定是什麼？",
      undefined, false, { page: context, contextUsed: false }
    )
  })
  it("OA 缺件直接依目前畫面回答，跨頁公司問題仍交給共用查詢", async () => {
    const session = askSessionFor("U01")
    const oa = {
      path: "/oa/forms/123/edit",
      title: "供應商建立請求",
      facts: ["缺少必填資料：聯絡電話、銀行資料"],
    }
    await session.ask("這張表單還缺什麼資料？", undefined, oa)
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user" },
      { kind: "model", text: expect.stringContaining("聯絡電話、銀行資料") },
    ])
    expect(api.routeAsk).not.toHaveBeenCalled()
    await session.ask("公司的付款規定是什麼？", undefined, oa)
    expect(api.routeAsk).toHaveBeenCalledTimes(1)
    expect(api.createAsk).toHaveBeenCalledTimes(1)
  })
  it("OA 提問有附檔時照原本的 AI 查詢，不拿頁面缺件取代附檔問題", async () => {
    const session = askSessionFor("U01")
    const oa = {
      path: "/oa/forms/123/edit",
      title: "供應商建立請求",
      facts: ["缺少必填資料：銀行資料"],
    }
    await session.ask(
      "這張表單還缺什麼資料？",
      new File(["receipt"], "receipt.txt"),
      oa
    )
    expect(api.routeAsk).toHaveBeenCalledTimes(1)
    expect(api.createAsk).toHaveBeenCalledTimes(1)
  })
  it("送出接續問題時也帶上先前 OA 的當頁即時問答", async () => {
    const session = askSessionFor("U01")
    const oa = {
      path: "/oa/new/6071",
      title: "申請單",
      facts: ["缺少必填資料：申請目的"],
    }
    await session.ask("這張表單還缺什麼資料？", undefined, oa)
    const response = session.conversation.getSnapshot()[1]
    await session.ask("那有哪些公司規定需要核對？", undefined, oa)
    expect(api.routeAsk).toHaveBeenCalledWith(
      "那有哪些公司規定需要核對？",
      false,
      [
        {
          question: "這張表單還缺什麼資料？",
          answer: response.kind === "model" ? response.text : "",
          page: oa,
        },
      ],
      oa
    )
  })
  it("打字要求示範會回覆純文字與示範指令，不查詢公司資料", async () => {
    const session = askSessionFor("U01")
    await session.ask("我不會新增訂單，可以教我嗎？", undefined, page())
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user" },
      { kind: "model", demo: "create-order", text: "好，現在操作給你看。" },
    ])
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("一般頁面的操作求助保留當時路徑，切頁後不會改為另一頁", async () => {
    const session = askSessionFor("U01")
    const context = { path: "/calendar?view=week", title: "日曆", facts: [] }
    await session.ask("操作給我看", undefined, context)
    context.path = "/customers"
    expect(session.conversation.getSnapshot()[1]).toMatchObject({
      demo: "page-tour",
      demoPath: "/calendar?view=week",
    })
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("指定日曆操作會提供日曆入口，資料問題仍走查詢", async () => {
    const session = askSessionFor("U01")
    await session.ask("教我用日曆", undefined, page())
    expect(session.conversation.getSnapshot()[1]).toMatchObject({
      demo: "page-tour",
      demoPath: "/calendar",
    })
    await session.ask("今天有幾個行程？", undefined, page())
    expect(api.routeAsk).toHaveBeenCalledOnce()
  })
  it.each([false, true])("對話紀錄示範接上目前對話並遵循保存模式，Ghost=%s", async (ghost) => {
    const session = askSessionFor("U01")
    await session.memory?.ready
    if (ghost) session.threads.enterGhost()
    const threadId = session.threads.getSnapshot().id
    await session.ask("教我用對話紀錄", undefined, page())
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user", threadId },
      { kind: "model", threadId, demo: "page-tour", demoPath: "/conversations" },
    ])
    expect(session.threads.history.getSnapshot()).toHaveLength(ghost ? 0 : 2)
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("報表操作求助交給報表示範流程，不送出資料查詢", async () => {
    const session = askSessionFor("U01")
    await session.ask("報表怎麼匯出？", undefined, page())
    expect(session.conversation.getSnapshot()).toMatchObject([
      { kind: "user" },
      { kind: "model", demo: "report-tour" },
    ])
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("帶報表情境的介面求助能辨識，數據問題仍走查詢", async () => {
    const session = askSessionFor("U01")
    const report = { path: "/reports", title: "報表", facts: [] }
    await session.ask("這頁怎麼篩選？", undefined, report)
    expect(session.conversation.getSnapshot()[1]).toMatchObject({
      demo: "report-tour",
    })
    await session.ask("報表的銷售為什麼減少？", undefined, report)
    expect(api.routeAsk).toHaveBeenCalledTimes(1)
    expect(api.createAsk).toHaveBeenCalledTimes(1)
  })
  it("我的申請單操作求助可就地邀請，進度問題仍走查詢", async () => {
    const session = askSessionFor("U01")
    const oa = { path: "/oa/forms/42/edit", title: "費用申請", facts: [] }
    await session.ask("這個表單怎麼填？", undefined, oa)
    expect(session.conversation.getSnapshot()[1]).toMatchObject({
      demo: "oa-tour",
    })
    expect(api.routeAsk).not.toHaveBeenCalled()
    expect(api.createAsk).not.toHaveBeenCalled()
    await session.ask("我的申請單為什麼還在審核？", undefined, oa)
    expect(api.routeAsk).toHaveBeenCalledTimes(1)
    expect(api.createAsk).toHaveBeenCalledTimes(1)
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
    await vi.waitFor(() => expect(api.routeAsk).toHaveBeenCalledOnce())
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
      undefined, false, { page: snapshot, contextUsed: true }
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
      undefined, false, { page: page(), contextUsed: false }
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
    expect(api.createAsk).toHaveBeenCalledWith("data", "康泰進貨狀況", photo, false, { page: elsewhere, contextUsed: false })
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
      undefined, false, { page: page(), contextUsed: false }
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
      undefined, false, { page: page(), contextUsed: undefined }
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
  it("記憶地圖跨頁保留，換帳號建立獨立的記憶視圖", () => {
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
