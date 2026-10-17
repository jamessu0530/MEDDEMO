import type { CalendarEvent, EventBody, EventFields } from "@/api/planner"

export const DISPLAY_ZONE = "Asia/Taipei"
export type CalendarView = "month" | "week" | "day" | "list"
const pad = (value: number) => String(value).padStart(2, "0")
// Intl formatter 建立成本高，日曆格子、行程標籤與 worker 都重用同一組。
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const timeFormats = new Map<string, Intl.DateTimeFormat>()
function cachedFormat(
  cache: Map<string, Intl.DateTimeFormat>,
  zone: string,
  options: Intl.DateTimeFormatOptions
) {
  let format = cache.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: zone })
    if (cache.size >= 32) cache.delete(cache.keys().next().value!)
    cache.set(zone, format)
  }
  return format
}

export function dateKey(value: string | Date, zone = DISPLAY_ZONE) {
  const parts = cachedFormat(dateFormats, zone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value))
  const read = (key: string) =>
    parts.find((part) => part.type === key)?.value ?? ""
  return `${read("year")}-${read("month")}-${read("day")}`
}
export function shiftDay(date: string, delta: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}
export function weekDays(date: string) {
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
  return Array.from({ length: 7 }, (_, index) =>
    shiftDay(date, index - weekday)
  )
}
export function monthDays(date: string) {
  const first = `${date.slice(0, 7)}-01`
  const lastValue = new Date(`${first}T12:00:00Z`)
  lastValue.setUTCMonth(lastValue.getUTCMonth() + 1)
  lastValue.setUTCDate(0)
  const start = weekDays(first)[0],
    end = weekDays(lastValue.toISOString().slice(0, 10))[6]
  const days = []
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day)
  return days
}
export function viewDays(anchor: string, view: CalendarView) {
  return view === "day"
    ? [anchor]
    : view === "week"
      ? weekDays(anchor)
      : monthDays(anchor)
}
export function localInput(value: string, zone = DISPLAY_ZONE) {
  const parts = cachedFormat(timeFormats, zone, {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value))
  const read = (key: string) =>
    parts.find((part) => part.type === key)?.value ?? "00"
  return `${read("year")}-${read("month")}-${read("day")}T${read("hour")}:${read("minute")}`
}
export function zonedIso(input: string, zone = DISPLAY_ZONE) {
  const normalized = input.length === 10 ? `${input}T00:00` : input.slice(0, 16)
  const target = Date.parse(`${normalized}:00Z`)
  if (!Number.isFinite(target)) throw new Error("日期或時間格式不正確")
  let guess = target
  for (let i = 0; i < 4; i++) {
    const shown = Date.parse(
      `${localInput(new Date(guess).toISOString(), zone)}:00Z`
    )
    const adjustment = target - shown
    if (!adjustment) return new Date(guess).toISOString()
    guess += adjustment
  }
  throw new Error("這個時間因夏令時間調整而不存在，請選擇其他時間")
}
export function timeLabel(value: string, zone = DISPLAY_ZONE) {
  return localInput(value, zone).slice(11)
}
export function minutesOfDay(value: string) {
  const local = localInput(value)
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
}
export function onDay(
  event: Pick<CalendarEvent, "starts_at" | "ends_at"> &
    Partial<Pick<CalendarEvent, "all_day" | "timezone">>,
  date: string
) {
  if (event.all_day)
    return (
      date >= dateKey(event.starts_at, event.timezone) &&
      date < dateKey(event.ends_at, event.timezone)
    )
  return (
    new Date(event.starts_at).getTime() <
      new Date(zonedIso(shiftDay(date, 1))).getTime() &&
    new Date(event.ends_at).getTime() > new Date(zonedIso(date)).getTime()
  )
}
export function eventBody(
  event: CalendarEvent,
  fields: EventFields = event
): EventBody {
  return {
    calendar_id: event.calendar_id,
    title: fields.title,
    starts_at: fields.starts_at,
    ends_at: fields.ends_at,
    timezone: fields.timezone,
    all_day: fields.all_day,
    location: fields.location,
    description: fields.description,
    url: fields.url,
    recurrence: fields.recurrence,
    reminders: fields.reminders,
    attendees: event.attendees.map((a) => a.email),
  }
}
export function moveEvent(
  event: CalendarEvent,
  date: string,
  minutes?: number
): EventBody {
  if (event.all_day) {
    const span = Math.round(
      (Date.parse(dateKey(event.ends_at, event.timezone)) -
        Date.parse(dateKey(event.starts_at, event.timezone))) /
        86400000
    )
    return {
      ...eventBody(event),
      starts_at: zonedIso(date, event.timezone),
      ends_at: zonedIso(shiftDay(date, span), event.timezone),
    }
  }
  const current = localInput(event.starts_at)
  const time =
    minutes === undefined
      ? current.slice(11)
      : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  const start = zonedIso(`${date}T${event.all_day ? "00:00" : time}`)
  const delta = new Date(start).getTime() - new Date(event.starts_at).getTime()
  return {
    ...eventBody(event),
    starts_at: start,
    ends_at: new Date(new Date(event.ends_at).getTime() + delta).toISOString(),
  }
}

export type CalendarEventTiming = Pick<
  CalendarEvent,
  "id" | "starts_at" | "ends_at" | "timezone" | "all_day"
>
export type EventPlacement<T = CalendarEvent> = {
  event: T
  top: number
  height: number
  column: number
  columns: number
}
/** Shared by the worker and the time-sliced fallback, including dense overlap groups. */
export function* layoutTimedEventsWork<T extends CalendarEventTiming>(
  events: T[],
  date: string
): Generator<void, EventPlacement<T>[]> {
  const start = new Date(zonedIso(date)).getTime(),
    end = new Date(zonedIso(shiftDay(date, 1))).getTime()
  const placements: EventPlacement<T>[] = []
  let work = 0
  for (const event of events) {
    const begins = Date.parse(event.starts_at),
      finishes = Date.parse(event.ends_at)
    if (!event.all_day && begins < end && finishes > start) {
      const top = Math.max(0, (begins - start) / 60000)
      const finish = Math.min(1440, (Math.min(end, finishes) - start) / 60000)
      placements.push({
        event,
        top,
        height: Math.max(30, finish - top),
        column: 0,
        columns: 1,
      })
    }
    if (++work % 128 === 0) yield
  }
  placements.sort(
    (a, b) =>
      a.top - b.top ||
      b.height - a.height ||
      a.event.id.localeCompare(b.event.id)
  )
  let group: EventPlacement<T>[] = [],
    groupEnd = 0
  let columns = 1
  function* finishGroup() {
    for (const p of group) {
      p.columns = columns
      if (++work % 128 === 0) yield
    }
    group = []
    columns = 1
    groupEnd = 0
  }
  for (const placement of placements) {
    if (placement.top >= groupEnd) yield* finishGroup()
    const occupied = new Set<number>()
    for (const p of group) {
      if (p.top + p.height > placement.top) occupied.add(p.column)
      if (++work % 128 === 0) yield
    }
    while (occupied.has(placement.column)) {
      placement.column++
      if (++work % 128 === 0) yield
    }
    group.push(placement)
    groupEnd = Math.max(groupEnd, placement.top + placement.height)
    columns = Math.max(columns, placement.column + 1)
    if (++work % 128 === 0) yield
  }
  yield* finishGroup()
  return placements
}

export function layoutTimedEvents<T extends CalendarEventTiming>(
  events: T[],
  date: string
): EventPlacement<T>[] {
  const work = layoutTimedEventsWork(events, date)
  let result = work.next()
  while (!result.done) result = work.next()
  return result.value
}

export const eventKey = (event: CalendarEvent) =>
  `${event.id}|${event.occurrence}`
export const RSVP_LABEL = {
  needs_action: "尚未回覆",
  accepted: "已接受",
  tentative: "暫定",
  declined: "已拒絕",
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失敗，請稍後再試"
}
