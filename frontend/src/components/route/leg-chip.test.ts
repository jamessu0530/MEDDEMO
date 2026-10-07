import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { LegOption } from "@/api/route"
import { LegChip, LegOptionList } from "@/components/route/leg-chip"
import { LEG_MODES, MODE_ICON, TRAVEL_MODE_LABEL } from "@/lib/travel-mode"

const chip = (props: Partial<Parameters<typeof LegChip>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LegChip, {
      mode: "scooter",
      minutes: 11,
      estimated: false,
      fromOffice: false,
      done: false,
      open: false,
      controls: "m",
      onClick: () => {},
      ...props,
    })
  )

const option = (mode: LegOption["mode"], minutes: number, extra: Partial<LegOption> = {}): LegOption => ({
  mode,
  minutes,
  km: 3.2,
  estimated: false,
  found: true,
  ...extra,
})

describe("LegChip", () => {
  it("寫交通方式與分鐘數，可以點", () => {
    const html = chip()
    expect(html).toContain("機車 11 分")
    expect(html).toContain("data-leg-chip")
    expect(html).not.toContain('disabled=""')
  })

  it("估算的加「約」；第一段寫從辦公室", () => {
    const html = chip({ estimated: true, fromOffice: true, mode: "drive", minutes: 18 })
    expect(html).toContain("從辦公室")
    expect(html).toContain("開車 約 18 分")
  })

  it("已經走完的段變灰、不能點，只寫交通方式", () => {
    const html = chip({ done: true, minutes: null })
    expect(html).toContain("disabled")
    expect(html).toContain(">機車<")
    expect(html).not.toContain("分")
  })

  it("沒給 onClick（例如用的是手機上的舊行程）就不能點", () => {
    expect(chip({ onClick: undefined })).toContain('disabled=""')
  })
})

describe("LegChip 認不得的交通方式", () => {
  it("沒有 travel_mode（舊快取）時當開車，不丟錯", () => {
    const html = chip({ mode: undefined as never, minutes: null })
    expect(html).toContain("開車")
  })
})

describe("LegOptionList", () => {
  it("四種交通方式與分鐘數，目前選的那個標起來", () => {
    const options = [option("drive", 18), option("scooter", 11), option("transit", 24), option("walk", 52)]
    const html = renderToStaticMarkup(
      createElement(LegOptionList, { options, current: "scooter", dayMode: "drive", failed: false, onPick: () => {} })
    )
    expect(html.match(/role="radio"/g)).toHaveLength(4)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    for (const text of ["開車", "18 分", "機車", "11 分", "大眾運輸", "24 分", "走路", "52 分"]) expect(html).toContain(text)
    expect(html).toContain("機車、走路路線是 Google 測試版")
    expect(html).toContain("Google Maps")
  })

  it("查不到路線的那一種寫估算的分鐘並說明", () => {
    const options = [
      option("drive", 18),
      option("scooter", 11),
      option("transit", 31, { estimated: true, found: false }),
      option("walk", 52),
    ]
    const html = renderToStaticMarkup(
      createElement(LegOptionList, { options, current: "drive", dayMode: "drive", failed: false, onPick: () => {} })
    )
    expect(html).toContain("約 31 分")
    expect(html).toContain("查不到路線，用估算")
    // 另外三個是 Google 算的：要標 Google Maps，不寫（估計）
    expect(html).toContain("Google Maps")
    expect(html).not.toContain("（估計）")
  })

  it("四個都是估算的才寫（估計），不寫 Google Maps", () => {
    const options = (["drive", "scooter", "transit", "walk"] as const).map((mode) =>
      option(mode, 20, { estimated: true })
    )
    const html = renderToStaticMarkup(
      createElement(LegOptionList, { options, current: "drive", dayMode: "drive", failed: false, onPick: () => {} })
    )
    expect(html).toContain("（估計）")
    expect(html).not.toContain("Google Maps")
  })

  it("圖示與名稱跟 LEG_MODES 同一組", () => {
    expect(Object.keys(MODE_ICON).sort()).toEqual([...LEG_MODES].sort())
    expect(Object.keys(TRAVEL_MODE_LABEL).sort()).toEqual([...LEG_MODES].sort())
  })

  it("還沒拿到分鐘數時是佔位條，照樣可以選", () => {
    const html = renderToStaticMarkup(
      createElement(LegOptionList, { options: null, current: "drive", dayMode: "drive", failed: false, onPick: () => {} })
    )
    expect(html.match(/role="radio"/g)).toHaveLength(4)
    expect(html).toContain("animate-pulse")
  })

  it("整天預設的那一列有標記", () => {
    const options = (["drive", "scooter", "transit", "walk"] as const).map((mode) => option(mode, 10))
    const html = renderToStaticMarkup(
      createElement(LegOptionList, { options, current: "walk", dayMode: "scooter", failed: false, onPick: () => {} })
    )
    expect(html.match(/整天預設/g)).toHaveLength(1)
    expect(html.indexOf("整天預設")).toBeGreaterThan(html.indexOf("機車"))
    expect(html.indexOf("整天預設")).toBeLessThan(html.indexOf("大眾運輸"))
  })
})
