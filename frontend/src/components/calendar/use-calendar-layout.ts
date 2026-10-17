import { startTransition, useEffect, useMemo, useRef, useState } from "react"
import type { CalendarEvent } from "@/api/planner"
import { monthDays, type EventPlacement } from "@/lib/planner"
import type { CalendarLayout } from "./calendar-layout"
import { createCalendarLayoutRunner } from "./calendar-layout-runner"

export type CalendarViewLayout = {
  days: Record<
    string,
    {
      events: CalendarEvent[]
      allDay: CalendarEvent[]
      timed: EventPlacement[]
    }
  >
  search: Record<string, CalendarEvent[]>
}
export const EMPTY_CALENDAR_DAY: CalendarViewLayout["days"][string] = {
  events: [],
  allDay: [],
  timed: [],
}
type CalendarViewInput = { events: CalendarEvent[]; days: string[] }

export function useCalendarLayout(events: CalendarEvent[], month: string) {
  // Precompute the whole grid so selecting another day or view reuses the result.
  const input = useMemo(
    () => ({ events, days: monthDays(`${month}-01`) }),
    [events, month]
  )
  const [snapshot, setSnapshot] = useState<{
    input: CalendarViewInput
    layout?: CalendarLayout
    error?: string
  } | null>(null)
  const runner = useRef<ReturnType<
    typeof createCalendarLayoutRunner<CalendarViewInput>
  > | null>(null)

  useEffect(() => {
    const task = createCalendarLayoutRunner<CalendarViewInput>(
      (layout, source) =>
        startTransition(() => setSnapshot({ input: source, layout })),
      (_error, source) =>
        setSnapshot({
          input: source,
          error: "日曆排版暫時無法完成，請重新整理。",
        })
    )
    runner.current = task
    return () => {
      task.dispose()
      runner.current = null
    }
  }, [])
  useEffect(() => {
    runner.current?.update(input)
  }, [input])

  const layout = useMemo<CalendarViewLayout | null>(() => {
    if (!snapshot?.layout) return null
    const source = snapshot.input.events
    const rows = (indices: number[]) => indices.map((index) => source[index])
    return {
      days: Object.fromEntries(
        Object.entries(snapshot.layout.days).map(([date, day]) => [
          date,
          {
            events: rows(day.events),
            allDay: rows(day.allDay),
            timed: day.timed.map(({ index, ...placement }) => ({
              ...placement,
              event: source[index],
            })),
          },
        ])
      ),
      search: Object.fromEntries(
        Object.entries(snapshot.layout.search).map(([date, indices]) => [
          date,
          rows(indices),
        ])
      ),
    }
  }, [snapshot])

  return {
    // Keep the current grid mounted during refreshes to retain its scroll position.
    // While it is pending, the page makes the old grid inert until the latest result arrives.
    layout: snapshot?.input.days[0] === input.days[0] ? layout : null,
    pending: snapshot?.input !== input,
    error: snapshot?.input === input ? snapshot.error : undefined,
  }
}
