import { ApiError } from "@/api/client"
import { controlRouteOrders, executeAssistantTask, planAssistantTasks, TASK_CAPABILITIES, TASK_PAGES, type TaskResult } from "@/api/assistant-tasks"
import { getAsk, type AskKind } from "@/api/asks"
import type { Conversation, UtteranceSource } from "@/ask/conversation"
import { recentConversationTurns } from "@/ask/conversation-context"
import type { AskPageContext } from "@/ask/page-context"
import { runAsk } from "@/ask/run-ask"
import { createTaskQueue, type AssistantTask } from "@/ask/task-queue"

type Target = { conversation: Conversation; source: UtteranceSource; page?: AskPageContext }
type Navigation = { key: number; path: string } | null

/** A serial executor permits new instructions while a resource request is in flight. */
export function createTaskSession(userId: string, signal: AbortSignal, persistent = true) {
  const storageKey = `meddemo:assistant-tasks:v1:${userId}`
  const queue = createTaskQueue({ capabilities: TASK_CAPABILITIES,
    storage: persistent && userId ? { read: () => localStorage.getItem(storageKey), write: (value) => localStorage.setItem(storageKey, value) } : undefined })
  const targets = new Map<string, Target>()
  const listeners = new Set<() => void>()
  let navigation: Navigation = null
  let sequence = 0
  let running = false
  const routeControls = new Set<string>()
  const intents = new Map<string, number>()
  const intent = (id: string) => { const value = (intents.get(id) ?? 0) + 1; intents.set(id, value); return value }
  const navigate = (task: AssistantTask) => {
    if (!task.resource || signal.aborted) return
    navigation = { key: ++sequence, path: task.resource.path }
    listeners.forEach((listener) => listener())
  }
  const message = (target: Target | undefined, text: string) => {
    if (!signal.aborted) target?.conversation.addUtterance("model", target.source, text, { page: target.page })
  }
  const executeQuery = async (task: AssistantTask, target: Target): Promise<TaskResult> => {
    const kind = task.capability.split(".")[0] as AskKind
    const entry = target.conversation.addToolRun(kind, task.instruction, { page: target.page })
    try {
      if (task.resource?.id && task.instruction === task.executedInstruction) {
        const ask = await getAsk(task.resource.id, signal)
        target.conversation.replace(entry, { ask })
        return { status: "completed", message: ask.answer || "已開啟先前查詢。", resource: task.resource }
      }
      if (task.instruction.length > 500) throw new Error("這項查詢太長，請縮短查詢內容後再繼續。")
      const ask = await runAsk(target.conversation, entry, kind, task.instruction, signal)
      if (ask.status === "failed") throw new Error(ask.error_message || "查詢失敗，請再試一次。")
      return { status: "completed", message: ask.answer || "查詢已完成，結果已保留在對話中。", resource: { path: "/ask", id: ask.id } }
    } catch (error) {
      target.conversation.replace(entry, { error: error instanceof Error ? error.message : "查詢失敗" })
      throw error
    }
  }
  const routeProgress = (taskId: string, result: TaskResult) => {
    if (result.batch && !signal.aborted) queue.progress(taskId, result.batch, result.message)
    return result
  }
  const executeRoute = async (task: AssistantTask): Promise<TaskResult> => {
    let result = routeProgress(task.id, await executeAssistantTask(task, signal))
    if (!result.batch || signal.aborted) return result
    const interrupted = () => queue.getSnapshot().tasks.find((item) => item.id === task.id)?.status !== "active" || routeControls.has(task.id)
    if (!interrupted() && result.batch.state !== "cancelled")
      result = routeProgress(task.id, await controlRouteOrders(task.id, "resume", undefined, signal))
    while (result.batch?.state === "running" && !signal.aborted && !interrupted()) {
      const store = result.batch.stores.find((item) => item.status === "pending")
      if (!store) break
      result = routeProgress(task.id, await controlRouteOrders(task.id, "step", store.customer_id, signal))
    }
    if (!signal.aborted && interrupted() && !routeControls.has(task.id)) {
      const cancelled = queue.getSnapshot().tasks.find((item) => item.id === task.id)?.status === "cancelled"
      result = routeProgress(task.id, await controlRouteOrders(task.id, cancelled ? "cancel" : "pause", undefined, signal))
    }
    return result
  }
  const adapters: Record<string, (task: AssistantTask, target: Target) => Promise<TaskResult>> = {
    "report.create": (task) => executeAssistantTask(task, signal),
    "order.create": (task) => executeAssistantTask(task, signal),
    "order.route_repeat": executeRoute,
    "data.query": executeQuery, "knowledge.query": executeQuery, "memory.query": executeQuery,
    "page.open": async (task) => {
      const path = task.instruction.trim()
      if (!(TASK_PAGES as readonly string[]).includes(path)) throw new Error("這個頁面目前無法由助理開啟，請指定頁面名稱。")
      return { status: "completed", message: `已準備開啟${task.title}。`, resource: { path } }
    },
  }
  const pump = async () => {
    if (running || signal.aborted) return
    running = true
    try {
      while (!signal.aborted) {
        const state = queue.getSnapshot()
        const active = state.tasks.find((task) => task.id === state.activeId && task.status === "pending" && !routeControls.has(task.id) &&
          task.dependsOn.every((dependency) => state.tasks.find((item) => item.id === dependency)?.status === "completed"))
        const task = active ?? queue.next((item) => targets.has(item.id) && !routeControls.has(item.id))
        if (!task) break
        const target = targets.get(task.id)
        if (!target) break // Restored work starts only after the user asks to continue it.
        if (!queue.activate(task.id) || !queue.begin(task.id)) break
        try {
          if (task.resource && task.executedInstruction === task.instruction && !task.capability.endsWith(".query")) {
            queue.complete(task.id, task.resource, task.message)
            navigate(task)
            continue
          }
          const adapter = adapters[task.capability]
          if (!adapter) throw new Error("這項工作尚未有可執行的操作。")
          const result = await adapter(task, target)
          if (signal.aborted) return
          const latest = queue.getSnapshot().tasks.find((item) => item.id === task.id)!
          if (result.batch) {
            routeProgress(task.id, result)
            if (latest.status === "active") {
              if (result.batch.state === "completed") queue.complete(task.id, null, result.message, task.instruction)
              else if (result.batch.state === "cancelled") queue.cancel(task.id)
              else queue.wait(task.id, result.message)
              message(target, result.message)
            }
            continue
          }
          if (result.status === "waiting") {
            if (latest.instruction === task.instruction && latest.status !== "cancelled") {
              queue.wait(task.id, result.message)
              message(target, result.message)
            }
          } else {
            const current = queue.getSnapshot().activeId === task.id && latest.instruction === task.instruction && latest.status !== "cancelled"
            queue.complete(task.id, result.resource, result.message, task.instruction)
            if (!task.capability.endsWith(".query")) message(target, result.message)
            if (current && !task.capability.endsWith(".query")) navigate({ ...task, resource: result.resource })
          }
        } catch (error) {
          if (signal.aborted) return
          const latest = queue.getSnapshot().tasks.find((item) => item.id === task.id)
          if (latest?.instruction === task.instruction && latest.status !== "cancelled" && latest.status !== "paused") {
            const text = error instanceof Error ? error.message : "工作尚未完成，請再試一次。"
            queue.fail(task.id, text)
            message(target, text)
          }
        }
      }
    } finally { running = false }
  }
  const stop = async (taskId: string, cancel = false) => {
    const task = queue.getSnapshot().tasks.find((item) => item.id === taskId)
    if (!task) return
    intent(taskId)
    if (cancel) queue.cancel(taskId)
    else queue.pause(taskId)
    if (task.capability === "order.route_repeat" && task.batch) {
      try { routeProgress(taskId, await controlRouteOrders(taskId, cancel ? "cancel" : "pause", undefined, signal)) }
      catch (error) { message(targets.get(taskId), error instanceof Error ? error.message : "進度同步失敗；本機已停止後續處理。") }
    }
  }
  return {
    queue,
    pause: (taskId: string) => stop(taskId),
    cancel: (taskId: string) => stop(taskId, true),
    startRoute(target: Target) {
      if (queue.getSnapshot().tasks.some((task) => task.capability === "order.route_repeat" && ["pending", "active"].includes(task.status))) return
      const ids = queue.apply({ handled: true, message: "", commands: [{ action: "create", key: "route", target_id: "",
        capability: "order.route_repeat", title: "今日路線照上次開單", instruction: "依目前業務今日路線，逐店照各自最近成交訂單的商品與數量，以目前供貨價建立草稿。", after: [] }] })
      ids.forEach((id) => targets.set(id, target))
      void pump()
    },
    async controlStore(taskId: string, action: "skip" | "retry", customerId: string, target: Target) {
      if (routeControls.has(taskId)) return
      const task = queue.getSnapshot().tasks.find((item) => item.id === taskId)
      if (!task || task.status === "cancelled") return
      const operation = intent(taskId)
      routeControls.add(taskId)
      queue.pause(taskId)
      try {
        routeProgress(taskId, await controlRouteOrders(taskId, "pause", undefined, signal))
        const result = routeProgress(taskId, await controlRouteOrders(taskId, action, customerId, signal))
        if (signal.aborted || intents.get(taskId) !== operation) return
        if (result.batch?.state === "completed") queue.complete(taskId, null, result.message, task.instruction)
        else if (result.batch?.state === "paused") queue.pause(taskId, result.message)
        else queue.wait(taskId, result.message)
        targets.set(taskId, target)
        if (action === "retry" || task.status === "active") {
          queue.apply({ handled: true, message: "", commands: [{ action: "resume", key: "resume", target_id: taskId,
            capability: "", title: "", instruction: "", after: [] }] })
        }
      } catch (error) {
        if (!signal.aborted && intents.get(taskId) === operation) queue.fail(taskId, error instanceof Error ? error.message : "無法更新店家進度，請重試。")
      } finally {
        routeControls.delete(taskId)
        void pump()
      }
    },
    getNavigation: () => navigation,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    acknowledgeNavigation(key: number) { if (navigation?.key === key) { navigation = null; listeners.forEach((listener) => listener()) } },
    openResource(taskId: string) {
      const task = queue.getSnapshot().tasks.find((item) => item.id === taskId)
      if (task) navigate(task)
    },
    async handle(question: string, target: Target) {
      const state = queue.getSnapshot()
      let plan
      try {
        plan = await planAssistantTasks(question, state.tasks, state.activeId, target.page, signal,
          recentConversationTurns(target.conversation.getSnapshot()))
      } catch (error) {
        // Existing query/help features remain usable on installations without AI tasks.
        if (error instanceof ApiError && [404, 503].includes(error.status) && !state.tasks.length &&
          !/開單|建.{0,5}報表|做.{0,5}報表|繼續.{0,8}任務|取消.{0,8}任務/.test(question)) return false
        throw error
      }
      if (signal.aborted) return true
      if (!plan.handled) return false
      const ids = queue.apply(plan)
      ids.forEach((id) => { targets.set(id, target); intent(id) })
      for (const id of ids) {
        const task = queue.getSnapshot().tasks.find((item) => item.id === id)
        if (task?.status === "paused" || task?.status === "cancelled") void stop(id, task.status === "cancelled")
      }
      message(target, plan.message)
      void pump()
      return true
    },
    resume(taskId: string, target: Target) {
      const task = queue.getSnapshot().tasks.find((item) => item.id === taskId)
      if (!task || !queue.activate(taskId)) return
      intent(taskId)
      targets.set(taskId, target)
      queue.apply({ handled: true, message: "", commands: [{ action: "resume", key: "resume", target_id: taskId,
        capability: "", title: "", instruction: "", after: [] }] })
      void pump()
    },
  }
}

export type TaskSession = ReturnType<typeof createTaskSession>
