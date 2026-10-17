import { afterEach, describe, expect, it, vi } from "vitest"
import {
  dateKey,
  layoutTimedEvents,
  layoutTimedEventsWork,
  monthDays,
  onDay,
  zonedIso,
  type CalendarEventTiming,
} from "@/lib/planner"
import {
  layoutCalendar,
  layoutCalendarAsync,
  type CalendarLayoutInput,
} from "./calendar-layout"

function event(
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEventTiming> = {}
): CalendarEventTiming {
  return {
    id,
    starts_at: zonedIso(start),
    ends_at: zonedIso(end),
    timezone: "Asia/Taipei",
    all_day: false,
    ...extra,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("日曆背景排版", () => {
  it("整月日期歸屬與原本一致，保留原始順序及重複系列的獨立索引", () => {
    const input: CalendarLayoutInput = {
      days: monthDays("2026-10-17"),
      events: [
        event("overnight", "2026-10-17T23:00", "2026-10-18T01:00"),
        event("midnight", "2026-10-17T23:00", "2026-10-18T00:00"),
        event("series", "2026-10-17T09:00", "2026-10-17T10:00"),
        event("series", "2026-10-18T09:00", "2026-10-18T10:00"),
        event("all-day", "2026-10-17", "2026-10-19", { all_day: true }),
        event("outside", "2026-12-01T09:00", "2026-12-01T10:00"),
      ],
    }
    const layout = layoutCalendar(input)
    for (const date of input.days) {
      const indices = input.events.flatMap((e, index) =>
        onDay(e, date) ? [index] : []
      )
      expect(layout.days[date].events).toEqual(indices)
      expect(layout.days[date].allDay).toEqual(
        indices.filter((index) => input.events[index].all_day)
      )
      const expected = layoutTimedEvents(input.events, date).map(
        ({ event: e, ...p }) => ({
          ...p,
          index: input.events.indexOf(e),
        })
      )
      expect(layout.days[date].timed).toEqual(expected)
    }
    expect(layout.days["2026-10-18"].events).toEqual([0, 3, 4])
    // Search groups by start date, including events outside the visible grid.
    expect(layout.search["2026-10-17"]).toEqual([0, 1, 2, 4])
    expect(layout.search["2026-12-01"]).toEqual([5])
  })

  it("全天依行程時區與排他結束日分組，涵蓋夏令時間", () => {
    const timezone = "America/New_York"
    const input = {
      days: ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"],
      events: [
        event("holiday", "2026-11-01", "2026-11-03", {
          all_day: true,
          timezone,
          starts_at: zonedIso("2026-11-01", timezone),
          ends_at: zonedIso("2026-11-03", timezone),
        }),
      ],
    }
    const layout = layoutCalendar(input)
    expect(input.days.map((day) => layout.days[day].allDay.length)).toEqual([
      0, 1, 1, 0,
    ])
    expect(layout.days["2026-11-01"].timed).toEqual([])
    expect(dateKey(input.events[0].starts_at, timezone)).toBe("2026-11-01")
  })

  it("重疊群組欄數正確，銜接事件重用空欄", () => {
    const input = {
      days: ["2026-10-17"],
      events: [
        event("a", "2026-10-17T09:00", "2026-10-17T10:00"),
        event("b", "2026-10-17T09:30", "2026-10-17T11:00"),
        event("c", "2026-10-17T10:00", "2026-10-17T10:30"),
        event("d", "2026-10-17T11:00", "2026-10-17T12:00"),
      ],
    }
    expect(
      layoutCalendar(input).days["2026-10-17"].timed.map((p) => [
        p.index,
        p.column,
        p.columns,
      ])
    ).toEqual([
      [0, 0, 2],
      [1, 1, 2],
      [2, 0, 2],
      [3, 0, 1],
    ])
  })

  it("單日密集重疊也能分批讓出執行時間，保持排列結果一致", async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => (now += 3))
    const input = {
      days: ["2026-10-17"],
      events: Array.from({ length: 160 }, (_, i) =>
        event(`${i}`, "2026-10-17T09:00", "2026-10-17T10:00")
      ),
    }
    const timer = vi.spyOn(globalThis, "setTimeout")
    const pending = layoutCalendarAsync(input, () => false)
    await vi.runAllTimersAsync()
    expect(await pending).toEqual(layoutCalendar(input))
    expect(timer.mock.calls.length).toBeGreaterThan(10)
    // The shared overlap solver itself yields, even when all events occupy one day.
    const work = layoutTimedEventsWork(input.events, input.days[0])
    expect(work.next().done).toBe(false)
  })

  it("降級計算可以在下一批開始前取消", async () => {
    vi.useFakeTimers()
    let cancelled = false
    const pending = layoutCalendarAsync(
      { events: [], days: ["2026-10-17"] },
      () => cancelled
    )
    cancelled = true
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()
  })
})
