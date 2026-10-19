import { jsonBody, request } from "@/api/client"

export type AttendanceEvent = {
  id: string
  direction: "in" | "out"
  occurred_at: string
  source: string
}
export type WorkplaceMember = {
  id: string
  name: string
  region: string
  status: "in_company" | "left_company" | "no_record"
  latest_event: AttendanceEvent | null
}
export type WorkGoal = {
  id: string
  title: string
  note: string
  due_date: string | null
  progress: number
}
export type GoalDraft = Omit<WorkGoal, "id">
export type Workplace = {
  date: string
  as_of: string
  user_id: string
  members: WorkplaceMember[]
  events: AttendanceEvent[]
  goals: WorkGoal[]
}

export const getWorkplace = (signal?: AbortSignal) =>
  request<Workplace>("/api/workplace", { signal })
export const recordPunch = (direction: "in" | "out", requestId: string) =>
  request<AttendanceEvent>(
    "/api/workplace/punch",
    jsonBody("POST", { direction, request_id: requestId })
  )
export const saveWorkGoal = (goal: GoalDraft, id?: string) =>
  request<WorkGoal>(
    id
      ? `/api/workplace/goals/${encodeURIComponent(id)}`
      : "/api/workplace/goals",
    jsonBody(id ? "PUT" : "POST", goal)
  )
export const deleteWorkGoal = (id: string) =>
  request<void>(`/api/workplace/goals/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
