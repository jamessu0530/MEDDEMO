import { describe, expect, it } from "vitest"
import { createTaskQueue, type TaskCommand } from "@/ask/task-queue"

const command = (key: string, after: string[] = []): TaskCommand => ({
  action: "create", key, after, target_id: "", capability: "report.create", title: key, instruction: `建立${key}`,
})
function setup() {
  let id = 0
  return createTaskQueue({ capabilities: ["report.create", "order.create"], id: () => `task-${++id}` })
}

describe("可接續的助理工作清單", () => {
  it("一次拆解十二項工作，依序等待依賴完成", () => {
    const queue = setup()
    const ids = queue.apply({ handled: true, message: "已安排", commands: Array.from({ length: 12 }, (_, n) => command(`step-${n}`, n ? [`step-${n - 1}`] : [])) })
    expect(ids).toHaveLength(12)
    expect(queue.activate(ids[1])).toBe(false)
    expect(queue.begin(ids[0])).toBe(true)
    queue.complete(ids[0], { path: "/reports?task_report=one", id: "one" }, "完成")
    expect(queue.next()?.id).toBe(ids[1])
    expect(queue.activate(ids[1])).toBe(true)
  })

  it("中途插入工作後仍保留原本報表資源，返回不會重建", () => {
    const queue = setup()
    const [report] = queue.apply({ handled: true, message: "", commands: [command("report")] })
    queue.begin(report)
    queue.complete(report, { path: "/reports?task_report=saved", id: "saved" }, "報表已儲存")
    const [order] = queue.apply({ handled: true, message: "", commands: [{ ...command("order"), capability: "order.create" }] })
    queue.begin(order)
    queue.wait(order, "請指定分店")
    queue.apply({ handled: true, message: "", commands: [{ ...command("back"), action: "resume", target_id: report }] })
    expect(queue.getSnapshot().tasks.find((task) => task.id === order)?.status).toBe("paused")
    expect(queue.getSnapshot().tasks.find((task) => task.id === report)).toMatchObject({ resource: { id: "saved" }, executedInstruction: "建立report" })
  })

  it("整份規劃先驗證，不會只建立有效的前半段", () => {
    const queue = setup()
    const before = queue.getSnapshot()
    expect(() => queue.apply({ handled: true, message: "", commands: [command("valid"), { ...command("invalid"), capability: "unknown" }] })).toThrow()
    expect(queue.getSnapshot()).toBe(before)
    expect(() => queue.apply({ handled: true, message: "", commands: [command("first", ["later"]), command("later")] })).toThrow()
    expect(queue.getSnapshot()).toBe(before)
  })

  it("取消前置工作後，不會跳過依賴執行下游", () => {
    const queue = setup()
    const [first, second] = queue.apply({ handled: true, message: "", commands: [command("first"), command("second", ["first"])] })
    queue.cancel(first)
    expect(queue.activate(second)).toBe(false)
    expect(queue.next()).toBeNull()
  })

  it("舊請求完成時保留新補充，取消中已建立的資源也可追溯", () => {
    const queue = setup()
    const [task] = queue.apply({ handled: true, message: "", commands: [command("report")] })
    queue.begin(task)
    queue.apply({ handled: true, message: "", commands: [{ ...command("refine"), action: "refine", target_id: task, instruction: "改成近三個月" }] })
    queue.complete(task, { path: "/reports", id: "saved" }, "原版完成", "建立report")
    expect(queue.getSnapshot().tasks[0]).toMatchObject({ status: "pending", instruction: "改成近三個月", executedInstruction: "建立report" })
    queue.cancel(task)
    queue.complete(task, { path: "/reports", id: "saved" }, "完成")
    expect(queue.getSnapshot().tasks[0]).toMatchObject({ status: "cancelled", resource: { id: "saved" } })
  })

  it("重新整理後保留工作，不自動重送中斷的建立請求", () => {
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const first = createTaskQueue({ capabilities: ["report.create"], storage })
    const [task] = first.apply({ handled: true, message: "", commands: [command("report")] })
    first.begin(task)
    const restored = createTaskQueue({ capabilities: ["report.create"], storage })
    expect(restored.getSnapshot()).toMatchObject({ activeId: null, tasks: [{ id: task, status: "waiting" }] })
    expect(restored.next()).toBeNull()
  })
})
