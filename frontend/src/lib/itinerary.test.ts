import { describe, expect, it } from "vitest"

import type { RouteDraft, RouteRule, RouteStop, TodayRoute } from "@/api/route"
import {
  brokenRules,
  draftAfterInsert,
  draftFrom,
  draftRules,
  dragHabit,
  durationHabit,
  formatMinutes,
  moveItem,
  proposalMarks,
  ruleNotes,
  shownStops,
  undoTarget,
  weekdayOf,
  whichQuestion,
  windowHabit,
  windowLabel,
  withoutStop,
} from "@/lib/itinerary"

const NAMES: Record<string, string> = { A: "德安藥局", B: "佑生藥局", C: "杏林診所", D: "康泰忠孝店" }

function stop(id: string, status: RouteStop["status"] = "todo", extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: id,
    customer_name: NAMES[id] ?? id,
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
    ...extra,
  }
}

function route(stops: RouteStop[], extra: Partial<TodayRoute> = {}): TodayRoute {
  return {
    date: "2026-10-28",
    rep: { id: "U01", name: "林昱辰" },
    version: 3,
    done: stops.filter((s) => s.status === "done").length,
    total: stops.length,
    urgent: null,
    stops,
    travel_minutes: 60,
    travel_km: 20,
    finish_time: "15:00",
    estimated: true,
    rules: [],
    violations: [],
    precedences: [],
    skipped_habits: [],
    ...extra,
  }
}

function draft(ids: string[], extra: Partial<RouteDraft> = {}): RouteDraft {
  return {
    stops: ids.map((id) => ({ customer_id: id, duration_minutes: 40, window_kind: null, window_time: null, note: null, locked: false })),
    precedences: [],
    skipped_habit_ids: [],
    habits: [],
    ...extra,
  }
}

function rule(id: string, kind: RouteRule["kind"], ids: string[], source: RouteRule["source"] = "habit"): RouteRule {
  return { id, text: `規則${id}`, kind, source, customer_ids: ids }
}

describe("草稿", () => {
  it("只拿還沒跑的站，先後與今天不套用的習慣照舊", () => {
    const today = route([stop("A", "done"), stop("B", "next", { locked: true }), stop("C")], {
      precedences: [{ before: "C", after: "B" }],
      skipped_habits: [{ id: 7, text: "x", reason: "你選了今天不套用", conflict: false }],
    })
    const result = draftFrom(today)
    expect(result.stops.map((s) => s.customer_id)).toEqual(["B", "C"])
    expect(result.stops[0].locked).toBe(true)
    expect(result.precedences).toEqual([{ before: "C", after: "B" }])
    expect(result.skipped_habit_ids).toEqual([7])
    expect(result.habits).toEqual([])
  })

  it("上移、下移", () => {
    expect(moveItem(["A", "B", "C", "D"], 3, 1)).toEqual(["A", "D", "B", "C"])
    expect(moveItem(["A", "B", "C", "D"], 0, 2)).toEqual(["B", "C", "A", "D"])
  })

  it("拿掉一站，跟它有關的先後一起拿掉", () => {
    const before = draft(["A", "B", "C"], { precedences: [{ before: "A", after: "B" }, { before: "C", after: "A" }, { before: "B", after: "C" }] })
    const after = withoutStop(before, "A")
    expect(after.stops.map((s) => s.customer_id)).toEqual(["B", "C"])
    expect(after.precedences).toEqual([{ before: "B", after: "C" }])
  })

  it("加一站回來照後端排的順序，原本的站保留草稿上的欄位", () => {
    const before = draft(["A", "B"])
    before.stops[0].note = "找王藥師"
    const view = route([stop("A"), stop("D", "todo", { duration_minutes: 60, window_kind: "before", window_time: "11:00" }), stop("B")])
    const after = draftAfterInsert(before, view)
    expect(after.stops.map((s) => s.customer_id)).toEqual(["A", "D", "B"])
    expect(after.stops[0].note).toBe("找王藥師")
    expect(after.stops[1]).toMatchObject({ duration_minutes: 60, window_kind: "before", window_time: "11:00" })
  })

  it("卡片的欄位用草稿的，時間用 preview 回來的", () => {
    const base = route([stop("A"), stop("B")])
    const view = route([stop("A", "todo", { planned_time: "10:05" }), stop("B")])
    const current = draft(["B", "A"])
    current.stops[1].duration_minutes = 90
    const shown = shownStops(current, view, base)
    expect(shown.map((s) => s.customer_id)).toEqual(["B", "A"])
    expect(shown[1]).toMatchObject({ planned_time: "10:05", duration_minutes: 90 })
  })
})

describe("拖完要不要記成習慣", () => {
  it("往上拖過 Y：X 排在 Y 前面", () => {
    const suggestion = dragHabit(["A", "B", "C", "D"], 3, 1, NAMES)
    expect(suggestion?.text).toBe("康泰忠孝店 排在 佑生藥局 前面")
    expect(suggestion?.habit).toMatchObject({
      kind: "precedence",
      subject: { by: "customer", value: "D" },
      object: { by: "customer", value: "B" },
      weekday: null,
    })
  })

  it("往下拖過 Y：Y 排在 X 前面", () => {
    const suggestion = dragHabit(["A", "B", "C", "D"], 0, 2, NAMES)
    expect(suggestion?.text).toBe("杏林診所 排在 德安藥局 前面")
    expect(suggestion?.habit).toMatchObject({ subject: { value: "C" }, object: { value: "A" } })
  })

  it("沒有動就不問", () => {
    expect(dragHabit(["A", "B"], 1, 1, NAMES)).toBeNull()
  })

  it("改停留、改約的時間", () => {
    expect(durationHabit("A", "德安藥局", 60)).toMatchObject({
      text: "以後去 德安藥局 都停 60 分",
      habit: { kind: "duration", duration_minutes: 60, subject: { by: "customer", value: "A" } },
    })
    expect(windowHabit("C", "杏林診所", "before", "11:00").text).toBe("以後 杏林診所 都約 11:00 以前")
    expect(windowHabit("C", "杏林診所", "at", "09:30").habit).toMatchObject({ kind: "window", window_kind: "at", window_time: "09:30" })
  })
})

describe("違反的規則", () => {
  it("今天的先後照草稿現算，習慣用 preview 回來的", () => {
    const fromServer = [rule("today:X>Y", "precedence", ["X", "Y"], "today"), rule("habit:1", "first", ["C"])]
    const rules = draftRules(draft(["A", "B", "C"], { precedences: [{ before: "B", after: "A" }] }), fromServer, NAMES)
    expect(rules.map((r) => r.id)).toEqual(["today:B>A", "habit:1"])
    expect(rules[0]).toMatchObject({ source: "today", text: "佑生藥局 排在 德安藥局 前面", customer_ids: ["B", "A"] })
  })

  it("先後、排第一、排最後；同一條習慣拆成好幾組只算一次", () => {
    const pairs = [rule("habit:7", "precedence", ["C", "A"]), rule("habit:7", "precedence", ["D", "A"])]
    const first = rule("habit:8", "first", ["B", "C"])
    const last = rule("habit:9", "last", ["A"])
    expect(brokenRules(["A", "B", "C", "D"], [...pairs, first, last]).map((r) => r.id)).toEqual(["habit:7", "habit:8", "habit:9"])
    expect(brokenRules(["B", "C", "D", "A"], [...pairs, first, last])).toEqual([])
    // 規則提到的客戶不在今天的行程裡就不算
    expect(brokenRules(["A", "B"], [rule("habit:3", "precedence", ["X", "A"])])).toEqual([])
  })

  it("先後寫在剛拖的那一站；不是它就寫在後面那一站", () => {
    const today = rule("today:B>A", "precedence", ["B", "A"], "today")
    expect(ruleNotes(["A", "B"], [today], NAMES, "B").get("B")?.[0].text).toBe("要在 德安藥局 之前")
    expect(ruleNotes(["A", "B"], [today], NAMES, null).get("A")?.[0].text).toBe("要在 佑生藥局 之後")
    const habit = rule("habit:8", "first", ["B", "C"])
    expect(ruleNotes(["A", "B", "C"], [habit], NAMES, "C").get("C")?.[0].text).toBe("規則habit:8")
    expect(ruleNotes(["A", "B", "C"], [habit], NAMES, "A").get("B")?.[0].text).toBe("規則habit:8")
  })

  it("復原回到最近一份不違反的草稿", () => {
    const fromServer = [rule("habit:1", "first", ["C"])]
    const history = [draft(["C", "A", "B"]), draft(["C", "B", "A"]), draft(["A", "C", "B"])]
    expect(undoTarget(history, ["habit:1"], fromServer, NAMES)).toBe(1)
    expect(undoTarget([draft(["A", "C"])], ["habit:1"], fromServer, NAMES)).toBeNull()
  })
})

describe("寫法", () => {
  it("星期幾、分鐘、約的時間", () => {
    expect(weekdayOf("2026-10-28")).toBe(2)
    expect(weekdayOf("2026-11-01")).toBe(6)
    expect(formatMinutes(75)).toBe("1 小時 15 分")
    expect(formatMinutes(120)).toBe("2 小時")
    expect(formatMinutes(50)).toBe("50 分")
    expect(windowLabel("at", "10:30")).toBe("約 10:30 到")
    expect(windowLabel("before", "11:00")).toBe("11:00 以前")
  })
})

describe("對照卡", () => {
  it("只動了一站就只標那一站", () => {
    expect([...proposalMarks(["A", "B", "C", "D"], ["A", "D", "B", "C"])]).toEqual(["D"])
  })

  it("新加的站要標，拿掉的不用", () => {
    expect([...proposalMarks(["A", "B"], ["A", "X", "B"])]).toEqual(["X"])
    expect([...proposalMarks(["A", "B", "C"], ["A", "C"])]).toEqual([])
  })

  it("沒動就都不標；整條倒過來只留一站不標", () => {
    expect(proposalMarks(["A", "B", "C"], ["A", "B", "C"]).size).toBe(0)
    expect(proposalMarks(["A", "B", "C"], ["C", "B", "A"]).size).toBe(2)
  })

  it("要選一個的問句", () => {
    expect(whichQuestion(["康泰 · 忠孝店", "康泰 · 大安店"])).toBe("你是說康泰 · 忠孝店，還是康泰 · 大安店？")
    expect(whichQuestion(["甲", "乙", "丙"])).toBe("你是說甲、乙，還是丙？")
    expect(whichQuestion(["甲"])).toBe("你是說甲嗎？")
  })
})
