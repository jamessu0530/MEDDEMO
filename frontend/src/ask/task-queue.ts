/** Task state is independent of the current page and of individual chat turns. */
export type TaskStatus = "pending" | "active" | "paused" | "waiting" | "completed" | "cancelled" | "error"

export type RouteOrderBatch = {
  state: "running" | "paused" | "waiting" | "completed" | "cancelled"
  revision: number
  rep_id: string
  rep_name: string
  route_id: number
  route_version: number
  route_date: string
  stores: {
    customer_id: string; customer_name: string
    status: "pending" | "completed" | "needs_attention" | "skipped"
    source_order_no: string | null; source_date: string | null
    message: string; warnings: string[]
    resource: { id: string; path: string } | null
    item_count?: number; amount?: number
  }[]
}

export type AssistantTask = {
  id: string
  capability: string
  title: string
  instruction: string
  executedInstruction: string | null
  status: TaskStatus
  dependsOn: string[]
  resource: { path: string; id?: string } | null
  batch?: RouteOrderBatch
  message: string
  createdAt: string
  updatedAt: string
}

export type TaskCommand = {
  action: "create" | "resume" | "refine" | "pause" | "cancel"
  key: string
  target_id: string
  capability: string
  title: string
  instruction: string
  after: string[]
}

export type TaskPlan = { handled: boolean; message: string; commands: TaskCommand[] }
export type TaskQueueSnapshot = { tasks: AssistantTask[]; activeId: string | null }
type Storage = { read: () => string | null; write: (value: string) => void }

const statuses: TaskStatus[] = ["pending", "active", "paused", "waiting", "completed", "cancelled", "error"]
const empty = (): TaskQueueSnapshot => ({ tasks: [], activeId: null })
const isFinished = (task: AssistantTask) => task.status === "completed" || task.status === "cancelled"

/** Only internal application paths are ever restored or followed. */
export function isTaskPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\s]/.test(path) &&
    Array.from(path).every((character) => character.charCodeAt(0) > 0x1f)
}

function validBatch(value: unknown): value is RouteOrderBatch {
  if (!value || typeof value !== "object") return false
  const batch = value as RouteOrderBatch
  return ["running", "paused", "waiting", "completed", "cancelled"].includes(batch.state) &&
    Number.isInteger(batch.revision) && batch.revision > 0 && Number.isInteger(batch.route_id) && Number.isInteger(batch.route_version) &&
    [batch.rep_id, batch.rep_name, batch.route_date].every((item) => typeof item === "string") &&
    Array.isArray(batch.stores) && batch.stores.length > 0 && batch.stores.every((store) => store &&
      [store.customer_id, store.customer_name, store.message].every((item) => typeof item === "string") &&
      ["pending", "completed", "needs_attention", "skipped"].includes(store.status) &&
      (store.source_order_no === null || typeof store.source_order_no === "string") &&
      (store.source_date === null || typeof store.source_date === "string") &&
      Array.isArray(store.warnings) && store.warnings.every((item) => typeof item === "string") &&
      (store.resource === null || (typeof store.resource?.id === "string" && typeof store.resource.path === "string" && isTaskPath(store.resource.path))))
}

function restore(value: string | null): TaskQueueSnapshot {
  if (!value) return empty()
  try {
    const saved: unknown = JSON.parse(value)
    if (!saved || typeof saved !== "object" || !("tasks" in saved) || !Array.isArray(saved.tasks)) return empty()
    const tasks: AssistantTask[] = []
    const ids = new Set<string>()
    for (const item of saved.tasks) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || ids.has(item.id) ||
        typeof item.capability !== "string" || typeof item.title !== "string" || typeof item.instruction !== "string" ||
        !statuses.includes(item.status) || !Array.isArray(item.dependsOn) ||
        !item.dependsOn.every((id: unknown) => typeof id === "string" && ids.has(id)) ||
        typeof item.message !== "string" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
        (item.resource !== null && (!item.resource || typeof item.resource.path !== "string" || !isTaskPath(item.resource.path))) ||
        (item.batch !== undefined && !validBatch(item.batch)))
        return empty()
      ids.add(item.id)
      // A reload cannot prove whether an interrupted write succeeded. Keep it
      // waiting for inspection instead of silently creating the resource again.
      tasks.push({ ...item, status: item.status === "active" ? "waiting" : item.status,
        message: item.status === "active" ? "上次處理曾中斷；按繼續確認結果，會沿用同一項工作。" : item.message })
    }
    return { tasks, activeId: null }
  } catch {
    return empty()
  }
}

export function createTaskQueue(options: {
  capabilities: readonly string[]
  storage?: Storage
  id?: () => string
  now?: () => string
}) {
  const id = options.id ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  let state = empty()
  try { state = restore(options.storage?.read() ?? null) } catch { /* Storage can be disabled. */ }
  const listeners = new Set<() => void>()
  const publish = (next: TaskQueueSnapshot) => {
    state = next
    try { options.storage?.write(JSON.stringify(state)) } catch { /* Keep the current session usable. */ }
    listeners.forEach((listener) => listener())
  }
  const change = (taskId: string, patch: Partial<AssistantTask>) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error("找不到這項工作。")
    publish({ ...state, tasks: state.tasks.map((item) => item.id === taskId ? { ...item, ...patch, updatedAt: now() } : item) })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Validate the entire plan before publishing any part of it. No task-count limit. */
    apply(plan: TaskPlan) {
      if (!plan.handled) return []
      const timestamp = now()
      let activeId = state.activeId
      let tasks = state.tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] }))
      const keys = new Map<string, string>()
      const affected: string[] = []
      for (const command of plan.commands) {
        if (!command.key || keys.has(command.key) || !["create", "resume", "refine", "pause", "cancel"].includes(command.action))
          throw new Error("工作拆解結果格式不正確，請再試一次。")
        const dependencies = command.after.map((reference) => keys.get(reference) ?? reference)
        if (!dependencies.every((reference) => tasks.some((task) => task.id === reference)))
          throw new Error("工作順序包含不存在或尚未建立的工作。")
        if (command.action === "create") {
          if (!options.capabilities.includes(command.capability) || !command.title.trim() || !command.instruction.trim())
            throw new Error("這項操作目前還無法執行，請改用頁面上的功能。")
          const taskId = id()
          if (tasks.some((task) => task.id === taskId)) throw new Error("工作識別碼重複，請再試一次。")
          tasks.push({ id: taskId, capability: command.capability, title: command.title,
            instruction: command.instruction, executedInstruction: null, dependsOn: dependencies, status: "pending", resource: null,
            message: "等待處理", createdAt: timestamp, updatedAt: timestamp })
          keys.set(command.key, taskId)
          affected.push(taskId)
        } else {
          const targetId = keys.get(command.target_id) ?? command.target_id
          const target = tasks.find((task) => task.id === targetId)
          if (!target) throw new Error("找不到要繼續或取消的工作，請指定工作名稱。")
          if (command.action !== "cancel" && target.status === "cancelled")
            throw new Error("這項工作已取消，請重新建立工作。")
          const patch: Partial<AssistantTask> = command.action === "cancel"
            ? { status: "cancelled", message: target.status === "active" ? "已停止後續處理；正在儲存的草稿仍會保留。" : "已取消" }
            : command.action === "pause" ? { status: "paused", message: "已暫停，進度已保留。" }
            : { status: "pending", ...(command.action === "refine"
              ? { instruction: command.instruction || target.instruction, message: "已補充需求" }
              : { message: "準備繼續" }) }
          tasks = tasks.map((task) => task.id === targetId ? { ...task, ...patch, updatedAt: timestamp } : task)
          if (targetId === activeId) activeId = null
          keys.set(command.key, targetId)
          affected.push(targetId)
        }
      }
      const next = affected.map((taskId) => tasks.find((task) => task.id === taskId)!).find((task) => task.status === "pending")
      if (next) {
        tasks = tasks.map((task) => task.id === activeId && !isFinished(task)
          ? { ...task, status: "paused", updatedAt: timestamp }
          : task)
        activeId = next.id
      }
      publish({ tasks, activeId })
      return affected
    },
    activate(taskId: string) {
      const target = state.tasks.find((task) => task.id === taskId)
      if (!target || target.status === "cancelled") return false
      if (target.dependsOn.some((dependency) => state.tasks.find((task) => task.id === dependency)?.status !== "completed"))
        return false
      publish({ activeId: taskId, tasks: state.tasks.map((task) => task.id === state.activeId && task.id !== taskId && task.status === "active"
        ? { ...task, status: "paused", updatedAt: now() } : task) })
      return true
    },
    begin(taskId: string) {
      if (state.activeId !== taskId) return false
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status === "cancelled" || task.status === "active" ||
        task.dependsOn.some((dependency) => state.tasks.find((item) => item.id === dependency)?.status !== "completed")) return false
      change(taskId, { status: "active", message: "處理中…" })
      return true
    },
    complete(taskId: string, resource: AssistantTask["resource"], message: string, instruction?: string) {
      if (resource && !isTaskPath(resource.path)) throw new Error("工作的頁面路徑不正確。")
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      const executedInstruction = instruction ?? task.instruction
      change(taskId, { status: task.status === "cancelled" ? "cancelled" : task.instruction === executedInstruction ? "completed" : "pending",
        resource, executedInstruction, message: task.status === "cancelled" ? `後續處理已取消；${message}` : message })
    },
    wait(taskId: string, message: string) { change(taskId, { status: "waiting", message }) },
    fail(taskId: string, message: string) { change(taskId, { status: "error", message }) },
    pause(taskId: string, message = "已暫停；正在儲存的這家完成後即停止，進度會保留。") {
      change(taskId, { status: "paused", message })
      if (state.activeId === taskId) publish({ ...state, activeId: null })
    },
    progress(taskId: string, batch: RouteOrderBatch, message: string) {
      if (!validBatch(batch)) throw new Error("路線工作進度格式不正確，請重新載入後續做。")
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || (task.batch && task.batch.revision > batch.revision)) return
      change(taskId, { batch, ...(task.status === "active" ? { message } : {}) })
    },
    cancel(taskId: string) {
      const task = state.tasks.find((item) => item.id === taskId)
      change(taskId, { status: "cancelled", message: task?.status === "active" ? "已停止後續處理；正在儲存的草稿仍會保留。" : "已取消" })
      if (state.activeId === taskId) publish({ ...state, activeId: null })
    },
    next(accept: (task: AssistantTask) => boolean = () => true) {
      return state.tasks.find((task) => accept(task) && task.status === "pending" &&
        task.dependsOn.every((dependency) => state.tasks.find((item) => item.id === dependency)?.status === "completed")) ?? null
    },
    clear() { publish(empty()) },
  }
}

export type TaskQueue = ReturnType<typeof createTaskQueue>
