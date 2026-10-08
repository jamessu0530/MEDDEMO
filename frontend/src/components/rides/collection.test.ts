import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { Vehicles } from "@/api/vehicles"
import { RideCollection } from "@/components/rides/collection"
import { formatTaipeiDateTime } from "@/lib/format"
import { RIDE_CITIES } from "@/lib/rides"
import { LEG_MODES } from "@/lib/travel-mode"

function vehicles(riddenAt: Record<string, string>): Vehicles {
  const items = RIDE_CITIES.flatMap((city) =>
    LEG_MODES.map((mode) => ({ city, mode, ridden_at: riddenAt[`${city}|${mode}`] ?? null }))
  )
  return { total: items.length, ridden: Object.keys(riddenAt).length, items }
}

const render = (data: Vehicles) => renderToStaticMarkup(createElement(RideCollection, { vehicles: data }))

describe("RideCollection", () => {
  const html = render(vehicles({ "台北市|drive": "2026-10-07T06:05:00Z" }))

  it("七個縣市各一區、每區四張卡，寫已收集 1/28", () => {
    expect(RIDE_CITIES.every((city) => html.includes(`aria-label="${city}"`))).toBe(true)
    expect(html.match(/<button/g)).toHaveLength(28)
    expect(html).toContain("已收集 1/28")
  })

  it("騎過的沒有剪影、寫台北時間；沒騎過的有剪影、寫還沒騎過", () => {
    expect(html.match(/ride-silhouette/g)).toHaveLength(27)
    expect(html.match(/還沒騎過/g)?.length).toBe(27 * 2) // aria-label 與卡上的字
    expect(html).toContain("10/7 14:05 第一次騎")
    expect(formatTaipeiDateTime("2026-10-07T17:30:00Z")).toBe("10/8 01:30")
  })

  it("平常都靜止，全都沒騎過時是 0/28", () => {
    expect(html.match(/ride-still/g)).toHaveLength(28)
    expect(render(vehicles({}))).toContain("已收集 0/28")
  })
})
