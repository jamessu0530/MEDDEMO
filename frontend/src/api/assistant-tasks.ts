import { jsonBody, request } from "@/api/client"
import type { Turn } from "@/api/asks"
import type { AskPageContext } from "@/ask/page-context"
import type { AssistantTask, RouteOrderBatch, TaskPlan } from "@/ask/task-queue"

export const TASK_CAPABILITIES = ["report.create", "order.create", "order.route_repeat", "data.query", "knowledge.query", "memory.query", "page.open"] as const
export const TASK_PAGES = ["/orders", "/reports", "/route", "/calendar", "/channels", "/customers", "/products", "/promotions", "/manager", "/settings", "/conversations"] as const

export function planAssistantTasks(question: string, tasks: AssistantTask[], activeId: string | null, page?: AskPageContext, signal?: AbortSignal, earlier: Turn[] = []) {
  return request<TaskPlan>("/api/assistant-tasks/plan", {
    ...jsonBody("POST", { question, tasks: tasks.map(({ id, capability, title, instruction, status, message }) =>
      ({ id, capability, title, instruction, status, message: message.slice(0, 8000) })), active_id: activeId, page, earlier }), signal,
  })
}

export type TaskResult = { status: "completed" | "waiting"; message: string; resource: AssistantTask["resource"]; batch?: RouteOrderBatch }
export function executeAssistantTask(task: AssistantTask, signal?: AbortSignal) {
  return request<TaskResult>("/api/assistant-tasks/execute", {
    ...jsonBody("POST", { task_id: task.id, capability: task.capability, instruction: task.instruction }), signal,
  })
}

export type RouteOrderControl = "step" | "pause" | "resume" | "skip" | "retry" | "cancel"
export function controlRouteOrders(taskId: string, action: RouteOrderControl, customerId?: string, signal?: AbortSignal) {
  return request<TaskResult>(`/api/assistant-tasks/${encodeURIComponent(taskId)}/route-orders`, {
    ...jsonBody("POST", { action, customer_id: customerId }), signal,
  })
}
