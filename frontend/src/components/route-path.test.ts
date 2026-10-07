import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { RouteStop } from "@/api/route"
import { RoutePath } from "@/components/route-path"

function stop(id: string, status: RouteStop["status"], extra: Partial<RouteStop> = {}): RouteStop {
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
    travel_mode: "drive",
    travel_estimated: false,
    city: "台北市",
    ...extra,
  }
}

const render = (stops: RouteStop[]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops })))

describe("RoutePath", () => {
  const day = [stop("a", "done", { visit_id: "v1" }), stop("b", "done"), stop("c", "next"), stop("d", "todo"), stop("e", "todo")]

  it("三種狀態的圓鈕，已完成的打勾、其他寫站號", () => {
    const html = render(day)
    expect(html.match(/data-stop-node="done"/g)).toHaveLength(2)
    expect(html.match(/data-stop-node="next"/g)).toHaveLength(1)
    expect(html.match(/data-stop-node="todo"/g)).toHaveLength(2)
    expect(html).toContain(">3<")
    expect(html).toContain("10:00 完成 · 已回寫")
  })

  it("只有下一站有「出發」，連到客戶檔案", () => {
    const html = render(day)
    expect(html.match(/>出發</g)).toHaveLength(1)
    expect(html).toContain('href="/customers/c"')
  })

  it("小卡一開始是收起來的", () => {
    const html = render(day)
    expect(html).not.toContain("data-stop-popover")
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(5)
  })

  it("熊熊滾站在路旁，點了進問答；還沒跑完是待機", () => {
    const html = render(day)
    expect(html).toContain('href="/ask"')
    expect(html).toContain('aria-label="問熊熊滾（問答）"')
    expect(html).toContain("mascot-idle")
    expect(html).toContain(">收工<")
  })

  it("全部跑完時終點寫跑完幾站，熊熊滾跳起來", () => {
    const html = render([stop("a", "done"), stop("b", "done"), stop("c", "done")])
    expect(html).toContain("今天 3 站都跑完了")
    expect(html).toContain("mascot-yay")
    expect(html).not.toContain(">出發<")
  })

  it("有約的時間又趕不上，標籤第二行改成紅字會晚到幾分", () => {
    const html = render([stop("a", "next", { window_kind: "before", window_time: "10:00", late_minutes: 25 }), stop("b", "todo")])
    expect(html).toContain("會晚到 25 分")
    expect(html.match(/會晚到/g)).toHaveLength(1)
  })
})
