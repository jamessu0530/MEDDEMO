import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { RouteRule, RouteStop } from "@/api/route"
import { StopCard, type StopCardProps } from "@/components/route/stop-card"

function stop(extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: "A", customer_name: "德安藥局 · 板橋", type: "independent", grade: "A", planned_time: "10:30",
    status: "todo", signal: "ar", reason: "帳款最久拖了 78 天", visit_id: null, source: "model", duration_minutes: 40,
    late_minutes: 0, travel_minutes: 12, travel_km: 4.1, window_kind: null, window_time: null, note: null,
    locked: false, habit_ids: [], ...extra,
  }
}

const NAMES = { A: "德安藥局 · 板橋", B: "佑生藥局 · 大安" }
const render = (props: Partial<StopCardProps>) =>
  renderToStaticMarkup(createElement(StopCard, { stop: stop(), number: 2, names: NAMES, precedences: [], ...props }))

describe("StopCard", () => {
  it("站號、店名、幾點到、停多久，可以拖也可以上移下移", () => {
    const html = render({ canMoveUp: true, canMoveDown: false })
    expect(html).toContain(">2<")
    expect(html).toContain("10:30 到 · 停 40 分")
    expect(html).toContain('aria-label="拖移 德安藥局 · 板橋"')
    expect(html).toContain('aria-label="上移 德安藥局 · 板橋"')
    expect(html).toMatch(/aria-label="下移 德安藥局 · 板橋"[^>]*disabled/)
  })

  it("小標籤：約的時間、鎖住、先後、備註、習慣、理由類別；會晚到寫紅字", () => {
    const html = render({
      stop: stop({ window_kind: "before", window_time: "11:00", locked: true, note: "找王藥師", habit_ids: [3], late_minutes: 25 }),
      precedences: [{ before: "B", after: "A" }],
    })
    for (const text of ["11:00 以前", "鎖住", "在 佑生藥局 · 大安 之後", "找王藥師", "習慣", "帳款", "會晚到 25 分"]) {
      expect(html).toContain(text)
    }
  })

  it("違反規則：紅框、寫哪一條，今天的先後可以拿掉，習慣可以今天不套用，回得去才有復原", () => {
    const today: RouteRule = { id: "today:B>A", text: "x", kind: "precedence", source: "today", customer_ids: ["B", "A"] }
    const habit: RouteRule = { id: "habit:3", text: "康泰連鎖藥局的店排在診所前面", kind: "precedence", source: "habit", customer_ids: ["A", "B"] }
    const html = render({
      notes: [{ rule: today, text: "要在 佑生藥局 · 大安 之後" }, { rule: habit, text: habit.text }],
      undoable: true,
    })
    expect(html).toContain('data-broken="true"')
    expect(html).toContain("違反：要在 佑生藥局 · 大安 之後")
    expect(html).toContain("拿掉這條限制")
    expect(html).toContain("違反：康泰連鎖藥局的店排在診所前面")
    expect(html).toContain("今天不套用這條")
    expect(html.match(/復原/g)).toHaveLength(2)
    expect(render({ notes: [{ rule: today, text: "要在 佑生藥局 · 大安 之後" }] })).not.toContain("復原")
  })

  it("已完成的站淡色、沒有把手，不能動", () => {
    const html = render({ stop: stop({ status: "done", planned_time: "09:50" }) })
    expect(html).toContain("09:50 完成")
    expect(html).not.toContain("拖移")
    expect(html).not.toContain("上移")
    expect(html).toContain("opacity-60")
  })
})
