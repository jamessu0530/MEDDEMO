import { afterEach, describe, expect, it } from "vitest"

import type { RouteStop, TodayRoute } from "@/api/route"
import { routeDraft } from "@/lib/route-draft"

function stop(id: string): RouteStop {
  return {
    customer_id: id, customer_name: id, type: "independent", grade: "A", planned_time: "10:00", status: "todo",
    signal: "ar", reason: "", visit_id: null, source: "model", duration_minutes: 40, late_minutes: 0,
    travel_minutes: 10, travel_km: 3, window_kind: null, window_time: null, note: null, locked: false, habit_ids: [],
  }
}

const today: TodayRoute = {
  date: "2026-10-28", rep: { id: "U01", name: "林昱辰" }, version: 1, done: 0, total: 2, urgent: null,
  stops: [stop("A"), stop("B")], travel_minutes: 20, travel_km: 6, finish_time: "11:00", estimated: true, travel_mode: "drive",
  rules: [], violations: [], precedences: [], skipped_habits: [],
}

describe("調整中的草稿", () => {
  afterEach(() => routeDraft.clear())

  it("開始、改、復原、清掉", () => {
    routeDraft.start(today)
    const first = routeDraft.get()!.draft
    expect(first.stops.map((s) => s.customer_id)).toEqual(["A", "B"])
    routeDraft.change({ ...first, stops: [...first.stops].reverse() }, "B")
    expect(routeDraft.get()!.history).toEqual([first])
    expect(routeDraft.get()!.moved).toBe("B")
    routeDraft.showView({ ...today, version: 5 }, routeDraft.get()!.draft)
    routeDraft.revert(0)
    expect(routeDraft.get()!.draft).toBe(first)
    expect(routeDraft.get()!.history).toEqual([])
    expect(routeDraft.get()!.view).toBe(today)
    routeDraft.clear()
    expect(routeDraft.get()).toBeNull()
  })

  it("preview 回來時草稿已經又改了，就不用那一份", () => {
    routeDraft.start(today)
    const asked = routeDraft.get()!.draft
    routeDraft.change({ ...asked, stops: asked.stops.slice(0, 1) })
    routeDraft.showView({ ...today, version: 99 }, asked)
    expect(routeDraft.get()!.view.version).toBe(1)
    const now = routeDraft.get()!.draft
    routeDraft.showView({ ...today, version: 2 }, now)
    expect(routeDraft.get()!.view.version).toBe(2)
  })
})
