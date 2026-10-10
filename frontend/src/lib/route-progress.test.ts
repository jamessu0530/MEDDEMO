import { describe, expect, it } from "vitest"

import type { RouteProgress, RouteStop, RouteUrgent, TodayRoute } from "@/api/route"
import { applyProgress } from "@/lib/route-progress"

function stop(id: string, status: RouteStop["status"]): RouteStop {
  return {
    customer_id: id,
    customer_name: `客戶${id}`,
    type: "independent",
    grade: "A",
    planned_time: "10:00",
    status,
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    visit_id: null,
    source: "model",
    duration_minutes: 40,
    late_minutes: 0,
    travel_minutes: 10,
    travel_km: 3.2,
    window_kind: null,
    window_time: null,
    note: null,
    locked: false,
    habit_ids: [],
    travel_mode: "scooter",
    travel_estimated: false,
    city: "台北市",
    arrived_at: null,
  }
}

const urgent: RouteUrgent = {
  customer_id: "a",
  customer_name: "客戶a",
  signal: "ar",
  headline: "帳款逾期",
  detail: "帳款最久拖了 78 天",
  note: null,
}

function route(extra: Partial<TodayRoute> = {}): TodayRoute {
  return {
    id: 7,
    date: "2026-10-28",
    rep: { id: "U01", name: "林昱辰" },
    version: 3,
    done: 0,
    total: 3,
    urgent,
    stops: [stop("a", "next"), stop("b", "todo"), stop("c", "todo")],
    travel_minutes: 42,
    travel_km: 12.5,
    finish_time: "13:10",
    estimated: false,
    travel_mode: "scooter",
    start_city: "台北市",
    office_start: true,
    rules: [],
    violations: [],
    precedences: [],
    skipped_habits: [],
    ...extra,
  }
}

const AT = "2026-10-28T02:15:00Z"

function progress(extra: Partial<RouteProgress> = {}): RouteProgress {
  return {
    itinerary_id: 7,
    stops: [
      { customer_id: "a", status: "done", arrived_at: AT },
      { customer_id: "b", status: "next", arrived_at: null },
      { customer_id: "c", status: "todo", arrived_at: null },
    ],
    done: 1,
    total: 3,
    urgent: null,
    ...extra,
  }
}

describe("applyProgress", () => {
  it("換掉每站的狀態、到過的時間、跑了幾站與需立即處理，其他照原本的", () => {
    const before = route()
    const after = applyProgress(before, progress())
    expect(after).not.toBeNull()
    expect(after!.stops.map((s) => [s.customer_id, s.status, s.arrived_at])).toEqual([
      ["a", "done", AT],
      ["b", "next", null],
      ["c", "todo", null],
    ])
    expect([after!.done, after!.total, after!.urgent]).toEqual([1, 3, null])
    // 點站不動時間、車程、交通方式與版本
    expect(after!.version).toBe(3)
    expect(after!.travel_minutes).toBe(42)
    expect(after!.stops[1].planned_time).toBe("10:00")
    expect(after!.stops[1].travel_mode).toBe("scooter")
    // 不改到原本那一份
    expect(before.stops[0].status).toBe("next")
  })

  it("需立即處理那家還沒到過就留著卡", () => {
    expect(applyProgress(route(), progress({ urgent }))!.urgent).toEqual(urgent)
  })

  it("不是同一份行程（IT 重置過）回 null", () => {
    expect(applyProgress(route(), progress({ itinerary_id: 8 }))).toBeNull()
  })

  it("站不一樣（別的評審加了、拿掉了一站）回 null", () => {
    const removed = progress({ stops: progress().stops.slice(0, 2), total: 2 })
    expect(applyProgress(route(), removed)).toBeNull()
    const swapped = progress({
      stops: [...progress().stops.slice(0, 2), { customer_id: "d", status: "todo", arrived_at: null }],
    })
    expect(applyProgress(route(), swapped)).toBeNull()
  })

  it("順序不一樣（別的評審剛排過）回 null", () => {
    const [a, b, c] = progress().stops
    expect(applyProgress(route(), progress({ stops: [a, c, b] }))).toBeNull()
  })
})
