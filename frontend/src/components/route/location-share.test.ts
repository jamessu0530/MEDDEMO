import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LocationShareView } from "@/components/route/location-share"
import type { SettingsStatus } from "@/lib/location-share"

const HOURS = { weekdays: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }
const noop = () => {}

const render = (state: SettingsStatus) =>
  renderToStaticMarkup(
    createElement(LocationShareView, {
      state,
      managerName: "陳建宏",
      hours: HOURS,
      busy: false,
      error: null,
      onConsent: noop,
      onPause: noop,
      onResume: noop,
      onHelp: noop,
    })
  )

describe("LocationShareView", () => {
  it("寫上班時間", () => {
    expect(render("sharing")).toContain("上班時間（週一到週五 08:30–18:30）主管看得到你的位置")
  })

  it("分享中：綠點、到幾點、暫停", () => {
    const html = render("sharing")
    expect(html).toContain("位置分享中，陳建宏看得到你在哪（到 18:30）")
    expect(html).toContain("bg-success")
    expect(html).toContain(">暫停<")
  })

  it("暫停中：琥珀點、繼續", () => {
    const html = render("paused")
    expect(html).toContain("已暫停分享，陳建宏會看到「暫停分享」")
    expect(html).toContain("bg-warning")
    expect(html).toContain(">繼續<")
  })

  it("沒有權限：怎麼開", () => {
    const html = render("denied")
    expect(html).toContain("沒有開定位權限，陳建宏看不到你在哪")
    expect(html).toContain(">怎麼開<")
  })

  it("還沒同意：開始分享", () => {
    const html = render("consent")
    expect(html).toContain("還沒開始分享")
    expect(html).toContain(">開始分享<")
  })

  it("下班時間：只寫一句，沒有按鈕", () => {
    const html = render("off")
    expect(html).toContain("下班時間，現在不分享位置")
    expect(html).not.toContain("<button")
  })

  it("不是業務、還沒問到：不顯示", () => {
    expect(render("hidden")).toBe("")
  })
})
