import { describe, expect, it } from "vitest"
import type { CalendarEvent } from "@/api/planner"
import {
  dateKey,
  layoutTimedEvents,
  localInput,
  monthDays,
  moveEvent,
  onDay,
  shiftDay,
  weekDays,
  zonedIso,
} from "@/lib/planner"

function event(
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {}
): CalendarEvent {
  return {
    id,
    uid: id,
    calendar_id: "mine",
    calendar_name: "我的日曆",
    color: "#9B51E0",
    source: "local",
    can_edit: true,
    sequence: 0,
    title: id,
    starts_at: zonedIso(start),
    ends_at: zonedIso(end),
    timezone: "Asia/Taipei",
    all_day: false,
    location: "",
    description: "",
    url: "",
    recurrence: null,
    reminders: [15],
    attendees: [],
    occurrence: zonedIso(start),
    series: {} as CalendarEvent["series"],
    ...extra,
  }
}

describe("行事曆日期與時區", () => {
  it("七欄完整週、跨年與閏年", () => {
    expect(weekDays("2027-01-01")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ])
    const days = monthDays("2028-02-12")
    expect(days).toContain("2028-02-29")
    expect(days.length % 7).toBe(0)
    expect(new Set(days).size).toBe(days.length)
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01")
  })
  it("使用指定時區，與執行機器的時區無關", () => {
    expect(zonedIso("2026-10-17T09:30")).toBe("2026-10-17T01:30:00.000Z")
    expect(localInput("2026-10-17T01:30:00+00:00")).toBe("2026-10-17T09:30")
    expect(dateKey("2026-12-31T18:00:00Z")).toBe("2027-01-01")
    expect(zonedIso("2026-11-01T09:00", "America/New_York")).toBe(
      "2026-11-01T14:00:00.000Z"
    )
  })
  it("拒絕因夏令時間跳過而不存在的時間", () => {
    expect(() => zonedIso("2026-03-08T02:30", "America/New_York")).toThrow(
      "不存在"
    )
  })
  it("午夜結束不多佔隔天，開始於隔天也不佔前一天", () => {
    const overnight = event("跨日", "2026-10-17T23:00", "2026-10-18T00:00")
    expect(onDay(overnight, "2026-10-17")).toBe(true)
    expect(onDay(overnight, "2026-10-18")).toBe(false)
    const next = {
      ...overnight,
      starts_at: "2026-10-17T16:00:00+00:00",
      ends_at: "2026-10-17T17:00:00+00:00",
    }
    expect(onDay(next, "2026-10-17")).toBe(false)
  })
})

describe("時間軸排版與移動", () => {
  it("全天日期不受顯示時區影響，跨夏令時間改期仍保留日數", () => {
    const before = event("假期", "2026-03-07T00:00", "2026-03-09T00:00", {
      all_day: true,
      timezone: "America/New_York",
      starts_at: zonedIso("2026-03-07", "America/New_York"),
      ends_at: zonedIso("2026-03-09", "America/New_York"),
    })
    expect(onDay(before, "2026-03-08")).toBe(true)
    expect(onDay(before, "2026-03-09")).toBe(false)
    const moved = moveEvent(before, "2026-11-01")
    expect(dateKey(moved.ends_at, before.timezone)).toBe("2026-11-03")
    expect(
      new Date(moved.ends_at).getTime() - new Date(moved.starts_at).getTime()
    ).toBe(49 * 3600000)
  })
  it("重疊行程並排，前後銜接的行程可以使用同一欄", () => {
    const rows = layoutTimedEvents(
      [
        event("a", "2026-10-17T09:00", "2026-10-17T10:00"),
        event("b", "2026-10-17T09:30", "2026-10-17T10:30"),
        event("c", "2026-10-17T10:30", "2026-10-17T11:00"),
      ],
      "2026-10-17"
    )
    expect(rows.map((r) => [r.event.id, r.column, r.columns])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ])
  })
  it("跨午夜的行程只繪製當天區段", () => {
    const overnight = event("夜間", "2026-10-17T23:00", "2026-10-18T01:00")
    expect(layoutTimedEvents([overnight], "2026-10-17")[0]).toMatchObject({
      top: 1380,
      height: 60,
    })
    expect(layoutTimedEvents([overnight], "2026-10-18")[0]).toMatchObject({
      top: 0,
      height: 60,
    })
  })
  it("拖曳維持活動長度並移到選定時段", () => {
    const before = event("會議", "2026-10-17T09:00", "2026-10-17T10:30")
    const moved = moveEvent(before, "2026-10-20", 14 * 60)
    expect(localInput(moved.starts_at)).toBe("2026-10-20T14:00")
    expect(localInput(moved.ends_at)).toBe("2026-10-20T15:30")
  })
})
