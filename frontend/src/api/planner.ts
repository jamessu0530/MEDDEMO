import { jsonBody, request, requestBlob } from "@/api/client"

export type CalendarCollection = {
  id: string
  name: string
  color: string
  source: "local" | "ics" | "caldav"
  role: "owner" | "editor" | "reader"
  status: "accepted" | "pending" | "declined"
  visible: boolean
  can_edit: boolean
  synced_at: string | null
  sync_error: string | null
  feed_enabled: boolean
}
export type Attendee = {
  email: string
  status: "needs_action" | "accepted" | "tentative" | "declined"
  is_me: boolean
}
export type EventFields = {
  title: string
  starts_at: string
  ends_at: string
  timezone: string
  all_day: boolean
  location: string
  description: string
  url: string
  recurrence: string | null
  reminders: number[]
}
export type CalendarEvent = EventFields & {
  id: string
  uid: string
  calendar_id: string
  calendar_name: string
  color: string
  source: CalendarCollection["source"]
  can_edit: boolean
  sequence: number
  occurrence: string
  attendees: Attendee[]
  series: EventFields
}
export type EventBody = EventFields & {
  calendar_id: string
  attendees: string[]
}
export type EditScope = "all" | "one" | "future"
export type CalendarWorkspace = {
  today: string
  timezone: string
  calendars: CalendarCollection[]
  invitations: CalendarEvent[]
  push_public_key: string | null
  email_invites_enabled: boolean
}
export type CalendarMember = {
  user_id: string
  name: string
  email: string | null
  role: "owner" | "reader" | "editor"
  status: string
}
export type CalendarNotice = {
  id: string
  event_id: string
  title: string
  starts_at: string
  due_at: string
}
export type CalendarPerson = { id: string; name: string; email: string | null }

const ROOT = "/api/planner"
export const getWorkspace = (signal?: AbortSignal) =>
  request<CalendarWorkspace>(ROOT, { signal })
export const getEvents = (start: string, end: string, signal?: AbortSignal) =>
  request<{ events: CalendarEvent[] }>(
    `${ROOT}/events?${new URLSearchParams({ start, end })}`,
    { signal }
  )
export const searchEvents = (q: string, signal?: AbortSignal) =>
  request<{ events: CalendarEvent[]; truncated: boolean }>(
    `${ROOT}/search?${new URLSearchParams({ q })}`,
    { signal }
  )
export const getEvent = (id: string, date?: string) =>
  request<CalendarEvent>(
    `${ROOT}/events/${id}${date ? `?${new URLSearchParams({ date })}` : ""}`
  )
export const saveEvent = (
  body: EventBody,
  event?: CalendarEvent,
  scope: EditScope = "all"
) =>
  event
    ? request<CalendarEvent>(
        `${ROOT}/events/${event.id}`,
        jsonBody("PUT", {
          ...body,
          scope,
          occurrence: event.occurrence,
          expected_sequence: event.sequence,
        })
      )
    : request<CalendarEvent>(`${ROOT}/events`, jsonBody("POST", body))
export const deleteEvent = (event: CalendarEvent, scope: EditScope) =>
  request<void>(
    `${ROOT}/events/${event.id}?${new URLSearchParams({ scope, occurrence: event.occurrence, expected_sequence: String(event.sequence) })}`,
    { method: "DELETE" }
  )
export const respondEvent = (id: string, status: Attendee["status"]) =>
  request(`${ROOT}/events/${id}/response`, jsonBody("PUT", { status }))
export const saveCalendar = (
  body: { name: string; color: string },
  id?: string
) =>
  request<CalendarCollection>(
    `${ROOT}/calendars${id ? `/${id}` : ""}`,
    jsonBody(id ? "PATCH" : "POST", body)
  )
export const setCalendarVisibility = (id: string, visible: boolean) =>
  request<void>(
    `${ROOT}/calendars/${id}/visibility`,
    jsonBody("PUT", { visible })
  )
export const deleteCalendar = (id: string) =>
  request<void>(`${ROOT}/calendars/${id}`, { method: "DELETE" })
export const getMembers = (id: string) =>
  request<{ members: CalendarMember[] }>(`${ROOT}/calendars/${id}/members`)
export const findCalendarPeople = (q: string, signal?: AbortSignal) =>
  request<{ people: CalendarPerson[] }>(
    `${ROOT}/people?${new URLSearchParams({ q })}`,
    { signal }
  )
export const shareCalendar = (
  id: string,
  user_id: string,
  role: "reader" | "editor"
) =>
  request(
    `${ROOT}/calendars/${id}/members`,
    jsonBody("POST", { user_id, role })
  )
export const removeCalendarMember = (id: string, userId: string) =>
  request<void>(`${ROOT}/calendars/${id}/members/${userId}`, {
    method: "DELETE",
  })
export const respondCalendar = (id: string, status: "accepted" | "declined") =>
  request(`${ROOT}/calendars/${id}/response`, jsonBody("PUT", { status }))
export const exportCalendar = (id: string) =>
  requestBlob(`${ROOT}/calendars/${id}/export.ics`)
export const exportInvitation = (id: string) =>
  requestBlob(`${ROOT}/events/${id}/invitation.ics`)
export const sendEventInvitations = (id: string, sequence: number) =>
  request<{ sent: string[]; failed: string[] }>(
    `${ROOT}/events/${id}/send-invitations?expected_sequence=${sequence}`,
    { method: "POST" }
  )
export const importCalendar = (id: string, file: File) => {
  const form = new FormData()
  form.append("file", file)
  return request<{ imported: number }>(`${ROOT}/calendars/${id}/import`, {
    method: "POST",
    body: form,
  })
}
export const enableCalendarFeed = (id: string) =>
  request<{ path: string }>(`${ROOT}/calendars/${id}/feed`, { method: "POST" })
export const disableCalendarFeed = (id: string) =>
  request<void>(`${ROOT}/calendars/${id}/feed`, { method: "DELETE" })
export type ConnectionBody = {
  name: string
  color: string
  source: "ics" | "caldav"
  url: string
  username: string
  password: string
}
export const discoverCalendars = (
  body: Pick<ConnectionBody, "url" | "username" | "password">
) =>
  request<{ calendars: { name: string; url: string }[] }>(
    `${ROOT}/connections/discover`,
    jsonBody("POST", body)
  )
export const connectCalendar = (body: ConnectionBody) =>
  request<CalendarCollection>(`${ROOT}/connections`, jsonBody("POST", body))
export const syncCalendar = (id: string, resolution?: "local" | "remote") =>
  request(
    `${ROOT}/calendars/${id}/sync${resolution ? `?resolution=${resolution}` : ""}`,
    { method: "POST" }
  )
export const getCalendarNotices = (signal?: AbortSignal) =>
  request<{ notifications: CalendarNotice[] }>(`${ROOT}/notifications`, {
    signal,
  })
export const readCalendarNotice = (id: string) =>
  request<void>(`${ROOT}/notifications/${id}/read`, { method: "PUT" })
export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  request(`${ROOT}/push`, jsonBody("POST", subscription))
export const deletePushSubscription = (endpoint: string) =>
  request<void>(`${ROOT}/push?${new URLSearchParams({ endpoint })}`, {
    method: "DELETE",
  })

export function downloadCalendarFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
