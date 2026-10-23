import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createConversation } from "@/ask/conversation"
import type { RouteOrderBatch, TaskCommand, TaskPlan } from "@/ask/task-queue"
import type { TaskResult } from "@/api/assistant-tasks"

const api = vi.hoisted(() => ({ plan: vi.fn(), execute: vi.fn(), control: vi.fn() }))
vi.mock("@/api/assistant-tasks", () => ({
  planAssistantTasks: api.plan, executeAssistantTask: api.execute,
  controlRouteOrders: api.control,
  TASK_CAPABILITIES: ["report.create", "order.create", "order.route_repeat", "data.query", "knowledge.query", "memory.query", "page.open"],
  TASK_PAGES: ["/reports", "/orders", "/calendar"],
}))
import { createTaskSession } from "@/ask/task-session"

const command = (key: string): TaskCommand => ({ action: "create", key, after: [], target_id: "", capability: "report.create", title: key, instruction: key })
const plan = (...commands: TaskCommand[]): TaskPlan => ({ handled: true, message: "已安排工作", commands })
const result = (id: string): TaskResult => ({ status: "completed", message: `完成${id}`, resource: { path: `/reports?task_report=${id}`, id } })
beforeEach(() => { api.plan.mockReset(); api.execute.mockReset(); api.control.mockReset() })
afterEach(() => vi.unstubAllGlobals())

describe("助理任務執行", () => {
  it("從前一輪找到剛剛查到的店家，將前文交給開單規劃", async () => {
    const conversation = createConversation()
    conversation.addUtterance("user", "typed", "剛剛查到哪一家店？")
    conversation.addUtterance("model", "typed", "康泰忠孝店，客戶編號 C1。")
    conversation.addUtterance("user", "typed", "幫我開那家店")
    api.plan.mockResolvedValue({ handled: true, message: "請確認商品", commands: [] })
    const session = createTaskSession("U01", new AbortController().signal, false)
    await session.handle("幫我開那家店", { conversation, source: "typed" })
    expect(api.plan.mock.calls[0][5]).toEqual([
      { question: "剛剛查到哪一家店？", answer: "康泰忠孝店，客戶編號 C1。" },
    ])
  })

  it.each(["typed", "voice"] as const)("%s 開單只在草稿儲存成功後跳到該張訂單", async (source) => {
    let finish!: (result: TaskResult) => void
    api.plan.mockResolvedValue(plan({ ...command("開康泰訂單"), capability: "order.create" }))
    api.execute.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const session = createTaskSession("U01", new AbortController().signal, false)
    await session.handle("幫我開那家店", { conversation: createConversation(), source })
    expect(session.getNavigation()).toBeNull()
    finish({ status: "completed", message: "草稿已儲存", resource: { path: "/orders/saved", id: "saved" } })
    await vi.waitFor(() => expect(session.getNavigation()?.path).toBe("/orders/saved"))
    const navigation = session.getNavigation()!
    session.acknowledgeNavigation(navigation.key)
    expect(session.getNavigation()).toBeNull()
    expect(session.queue.getSnapshot().tasks[0].resource?.id).toBe("saved")
  })

  it("資料不足或建立失敗時保留提示，不導覽或宣稱已完成", async () => {
    api.plan.mockResolvedValue(plan({ ...command("order"), capability: "order.create" }))
    api.execute.mockResolvedValueOnce({ status: "waiting", message: "請指定店家", resource: null })
    const session = createTaskSession("U01", new AbortController().signal, false)
    const target = { conversation: createConversation(), source: "typed" as const }
    await session.handle("開單", target)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("waiting"))
    expect(session.getNavigation()).toBeNull()
    api.execute.mockRejectedValueOnce(new Error("草稿未能儲存"))
    session.resume(session.queue.getSnapshot().tasks[0].id, target)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("error"))
    expect(session.getNavigation()).toBeNull()
    expect(session.queue.getSnapshot().tasks[0].resource).toBeNull()
  })

  it("連續處理八項工作，返回既有工作不會再次建立", async () => {
    api.plan.mockResolvedValue(plan(...Array.from({ length: 8 }, (_, n) => command(`r${n}`))))
    api.execute.mockImplementation(async (task) => result(task.title))
    const session = createTaskSession("U01", new AbortController().signal, false)
    const target = { conversation: createConversation(), source: "typed" as const }
    expect(await session.handle("建立八份報表", target)).toBe(true)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks.every((task) => task.status === "completed")).toBe(true))
    expect(api.execute).toHaveBeenCalledTimes(8)
    const first = session.queue.getSnapshot().tasks[0]
    session.resume(first.id, target)
    await vi.waitFor(() => expect(session.getNavigation()?.path).toBe("/reports?task_report=r0"))
    expect(api.execute).toHaveBeenCalledTimes(8)
  })

  it("中途加入新工作，舊請求的回應不能把畫面切回舊任務", async () => {
    let finish!: (result: TaskResult) => void
    api.plan.mockResolvedValueOnce(plan(command("report"))).mockResolvedValueOnce(plan({ ...command("order"), capability: "order.create" }))
    api.execute.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce(result("order"))
    const session = createTaskSession("U01", new AbortController().signal, false)
    const target = { conversation: createConversation(), source: "typed" as const }
    await session.handle("做報表", target)
    await session.handle("先開單", target)
    finish(result("report"))
    await vi.waitFor(() => expect(session.getNavigation()?.path).toBe("/reports?task_report=order"))
    expect(session.queue.getSnapshot().tasks.every((task) => task.resource)).toBe(true)
  })

  it("缺資料的工作保留進度，後面獨立工作仍能完成", async () => {
    api.plan.mockResolvedValue(plan(command("missing"), command("ready")))
    api.execute.mockResolvedValueOnce({ status: "waiting", message: "要看哪段期間？", resource: null }).mockResolvedValueOnce(result("ready"))
    const session = createTaskSession("U01", new AbortController().signal, false)
    await session.handle("安排兩個工作", { conversation: createConversation(), source: "typed" })
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks.map((task) => task.status)).toEqual(["waiting", "completed"]))
  })

  it("第一項被依賴擋住時，仍會處理後面的獨立工作", async () => {
    api.plan.mockResolvedValueOnce(plan(command("missing")))
    api.execute.mockResolvedValueOnce({ status: "waiting", message: "請指定客戶", resource: null })
    const session = createTaskSession("U01", new AbortController().signal, false)
    const target = { conversation: createConversation(), source: "typed" as const }
    await session.handle("先開單", target)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("waiting"))
    const missing = session.queue.getSnapshot().tasks[0].id
    api.plan.mockResolvedValueOnce(plan({ ...command("blocked"), after: [missing] }, command("independent")))
    api.execute.mockResolvedValueOnce(result("independent"))
    await session.handle("接著做報表，另外查其他資料", target)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[2].status).toBe("completed"))
    expect(session.queue.getSnapshot().tasks[1].status).toBe("pending")
  })

  it("停止會話後不繼續執行下一項或導覽", async () => {
    let finish!: (result: TaskResult) => void
    api.plan.mockResolvedValue(plan(command("first"), command("second")))
    api.execute.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const abort = new AbortController()
    const session = createTaskSession("U01", abort.signal, false)
    await session.handle("建立兩份", { conversation: createConversation(), source: "typed" })
    abort.abort()
    finish(result("first"))
    await Promise.resolve()
    expect(api.execute).toHaveBeenCalledOnce()
    expect(session.getNavigation()).toBeNull()
  })
})

function batchResult(stores = 8): TaskResult & { batch: RouteOrderBatch } {
  return { status: "waiting", message: "路線處理中", resource: null, batch: {
    state: "running", revision: 1, rep_id: "S1", rep_name: "業務一", route_id: 1, route_version: 2, route_date: "2031-04-17",
    stores: Array.from({ length: stores }, (_, n) => ({ customer_id: `C${n}`, customer_name: `店家 ${n}`,
      source_order_no: `O${n}`, source_date: "2031-04-01", status: "pending", message: "等待建立", warnings: [], resource: null })),
  } }
}

function routeServer(stores = 8) {
  const state = batchResult(stores)
  const respond = (action: string, customerId?: string) => {
    const store = state.batch.stores.find((item) => item.customer_id === customerId)
    if (action === "pause") state.batch.state = "paused"
    if (action === "resume") state.batch.state = "running"
    if (action === "cancel") state.batch.state = "cancelled"
    if (action === "step" && store && state.batch.state === "running") {
      store.status = "completed"
      store.resource = { id: store.customer_id, path: `/orders/${store.customer_id}` }
      store.message = "草稿已儲存"
    }
    if (action === "skip" && store) store.status = "skipped"
    if (action === "retry" && store) store.status = "pending"
    if (state.batch.state === "running" && state.batch.stores.every((item) => ["completed", "skipped"].includes(item.status))) {
      state.batch.state = "completed"
      state.status = "completed"
    }
    state.batch.revision++
    return structuredClone(state)
  }
  api.execute.mockImplementation(async () => structuredClone(state))
  api.control.mockImplementation(async (_id, action, customerId) => respond(action, customerId))
  return { state, respond }
}

describe("路線逐店開單", () => {
  const target = () => ({ conversation: createConversation(), source: "typed" as const })

  it("逐店處理八家並保存各草稿入口，保留路線畫面", async () => {
    routeServer()
    const session = createTaskSession("S1", new AbortController().signal, false)
    session.startRoute(target())
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("completed"))
    expect(api.control.mock.calls.filter((call) => call[1] === "step").map((call) => call[2])).toEqual(Array.from({ length: 8 }, (_, n) => `C${n}`))
    expect(session.queue.getSnapshot().tasks[0].batch?.stores.every((store) => store.resource)).toBe(true)
    expect(session.getNavigation()).toBeNull()
  })

  it("暫停時保留正在儲存的一家，續做只處理剩下店家", async () => {
    const server = routeServer(3)
    let finish!: () => void
    api.control.mockImplementation(async (_id, action, customerId) => {
      if (action === "step" && customerId === "C0")
        return new Promise((resolve) => { finish = () => { server.state.batch.state = "running"; resolve(server.respond(action, customerId)) } })
      return server.respond(action, customerId)
    })
    const session = createTaskSession("S1", new AbortController().signal, false)
    const destination = target()
    session.startRoute(destination)
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    const id = session.queue.getSnapshot().tasks[0].id
    await session.pause(id)
    finish()
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].batch?.stores[0].status).toBe("completed"))
    expect(session.queue.getSnapshot().tasks[0].status).toBe("paused")
    expect(api.control.mock.calls.filter((call) => call[1] === "step")).toHaveLength(1)
    session.resume(id, destination)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("completed"))
    expect(api.control.mock.calls.filter((call) => call[1] === "step").map((call) => call[2])).toEqual(["C0", "C1", "C2"])
  })

  it("插入報表時暫停路線，回來繼續沿用原有草稿", async () => {
    const server = routeServer(3)
    let finish!: () => void
    api.control.mockImplementation(async (_id, action, customerId) => {
      if (action === "step" && customerId === "C0")
        return new Promise((resolve) => { finish = () => resolve(server.respond(action, customerId)) })
      return server.respond(action, customerId)
    })
    api.plan.mockResolvedValue(plan(command("new-report")))
    api.execute.mockImplementation(async (task) => task.capability === "report.create" ? result("report") : structuredClone(server.state))
    const session = createTaskSession("S1", new AbortController().signal, false)
    const destination = target()
    session.startRoute(destination)
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    await session.handle("先做報表", destination)
    finish()
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[1].status).toBe("completed"))
    expect(session.queue.getSnapshot().tasks[0].status).toBe("paused")
    expect(server.state.batch.stores[0].status).toBe("completed")
    expect(api.control.mock.calls.filter((call) => call[1] === "step")).toHaveLength(1)
    session.resume(session.queue.getSnapshot().tasks[0].id, destination)
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("completed"))
    expect(api.control.mock.calls.filter((call) => call[1] === "step")).toHaveLength(3)
  })

  it("取消後即使目前一家完成，也不會繼續或遺失已建草稿", async () => {
    const server = routeServer(2)
    let finish!: () => void
    api.control.mockImplementation(async (_id, action, customerId) => {
      if (action === "step") return new Promise((resolve) => {
        finish = () => {
          server.state.batch.stores[0].status = "completed"
          server.state.batch.stores[0].resource = { id: "saved", path: "/orders/saved" }
          resolve(server.respond("pause"))
        }
      })
      return server.respond(action, customerId)
    })
    const session = createTaskSession("S1", new AbortController().signal, false)
    session.startRoute(target())
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    await session.cancel(session.queue.getSnapshot().tasks[0].id)
    finish()
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].batch?.stores[0].resource?.id).toBe("saved"))
    expect(session.queue.getSnapshot().tasks[0].status).toBe("cancelled")
    expect(api.control.mock.calls.filter((call) => call[1] === "step")).toHaveLength(1)
  })

  it("重新整理後查回已完成的店家，只執行剩下店家", async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    const server = routeServer(3)
    const firstAbort = new AbortController()
    const first = createTaskSession("S1", firstAbort.signal)
    let finish!: () => void
    api.control.mockImplementation(async (_id, action, customerId) => {
      if (action === "step" && customerId === "C0") return new Promise((resolve) => { finish = () => resolve(server.respond(action, customerId)) })
      return server.respond(action, customerId)
    })
    first.startRoute(target())
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    firstAbort.abort()
    finish()
    await Promise.resolve()
    const restored = createTaskSession("S1", new AbortController().signal)
    expect(restored.queue.getSnapshot().tasks[0].status).toBe("waiting")
    restored.resume(restored.queue.getSnapshot().tasks[0].id, target())
    await vi.waitFor(() => expect(restored.queue.getSnapshot().tasks[0].status).toBe("completed"))
    expect(api.control.mock.calls.filter((call) => call[1] === "step").map((call) => call[2])).toEqual(["C0", "C1", "C2"])
  })

  it("暫停後跳過一家，續做不再執行被跳過的店家", async () => {
    const server = routeServer(3)
    const session = createTaskSession("S1", new AbortController().signal, false)
    const [id] = session.queue.apply(plan({ ...command("route"), capability: "order.route_repeat" }))
    session.queue.progress(id, server.state.batch, "進度已保存")
    session.queue.pause(id)
    await session.controlStore(id, "skip", "C0", target())
    expect(session.queue.getSnapshot().tasks[0].batch?.stores[0].status).toBe("skipped")
    session.resume(id, target())
    await vi.waitFor(() => expect(session.queue.getSnapshot().tasks[0].status).toBe("completed"))
    expect(api.control.mock.calls.filter((call) => call[1] === "step").map((call) => call[2])).toEqual(["C1", "C2"])
  })
})
