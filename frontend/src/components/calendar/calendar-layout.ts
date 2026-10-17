import {
  dateKey,
  layoutTimedEventsWork,
  shiftDay,
  zonedIso,
  type CalendarEventTiming,
  type EventPlacement,
} from "@/lib/planner"

export type CalendarLayoutInput = {
  events: CalendarEventTiming[]
  days: string[]
}
export type CalendarDayLayout = {
  events: number[]
  allDay: number[]
  timed: (Omit<EventPlacement, "event"> & { index: number })[]
}
export type CalendarLayout = {
  days: Record<string, CalendarDayLayout>
  search: Record<string, number[]>
}

function* layoutWork(
  input: CalendarLayoutInput
): Generator<void, CalendarLayout> {
  const days: CalendarLayout["days"] = {}
  const search: CalendarLayout["search"] = {}
  const ranges = input.days.map((date) => {
    days[date] = { events: [], allDay: [], timed: [] }
    return {
      date,
      start: Date.parse(zonedIso(date)),
      end: Date.parse(zonedIso(shiftDay(date, 1))),
    }
  })
  let work = 0
  for (let index = 0; index < input.events.length; index++) {
    const event = input.events[index]
    const searchDate = dateKey(event.starts_at)
    ;(search[searchDate] ??= []).push(index)
    const start = Date.parse(event.starts_at),
      end = Date.parse(event.ends_at)
    const firstDate = event.all_day
      ? dateKey(event.starts_at, event.timezone)
      : ""
    const endDate = event.all_day ? dateKey(event.ends_at, event.timezone) : ""
    for (const range of ranges) {
      const matches = event.all_day
        ? range.date >= firstDate && range.date < endDate
        : start < range.end && end > range.start
      if (matches) {
        days[range.date].events.push(index)
        if (event.all_day) days[range.date].allDay.push(index)
      }
      if (++work % 128 === 0) yield
    }
  }
  for (const date of input.days) {
    const events = days[date].events.map((index) => ({
      ...input.events[index],
      index,
    }))
    const placements = yield* layoutTimedEventsWork(events, date)
    days[date].timed = placements.map(({ event, ...placement }) => ({
      ...placement,
      index: event.index,
    }))
    yield
  }
  return { days, search }
}

export function layoutCalendar(input: CalendarLayoutInput) {
  const work = layoutWork(input)
  let result = work.next()
  while (!result.done) result = work.next()
  return result.value
}

/** Worker unavailable: give input and painting a turn at least every 4 ms. */
export async function layoutCalendarAsync(
  input: CalendarLayoutInput,
  cancelled: () => boolean
) {
  const work = layoutWork(input)
  // Let the date/view indicator paint before starting a fallback calculation.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  let started = performance.now()
  while (!cancelled()) {
    const result = work.next()
    if (result.done) return result.value
    if (performance.now() - started >= 4) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      started = performance.now()
    }
  }
  return null
}
