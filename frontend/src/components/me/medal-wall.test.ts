import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { Medal } from "@/api/me"
import { FlatMedal } from "@/components/me/flat-medal"
import { MedalWall } from "@/components/me/medal-wall"

const at = "2026-10-28T09:18:00+08:00"
const medals: Medal[] = [
  { kind: "stores", tier: 1, need: 1, have: 3, unlocked_on: "2026-10-28", unlocked_at: at },
  { kind: "stores", tier: 2, need: 3, have: 3, unlocked_on: "2026-10-28", unlocked_at: at },
  { kind: "stores", tier: 3, need: 5, have: 3, unlocked_on: null, unlocked_at: null },
  { kind: "cities", tier: 1, need: 1, have: 2, unlocked_on: "2026-10-28", unlocked_at: at },
  { kind: "cities", tier: 2, need: 2, have: 2, unlocked_on: "2026-10-28", unlocked_at: at },
  { kind: "cities", tier: 3, need: 3, have: 2, unlocked_on: null, unlocked_at: null },
]

describe("MedalWall", () => {
  const html = renderToStaticMarkup(createElement(MedalWall, { medals, userId: "U01" }))

  it("兩列各三面，右上角寫解鎖幾面", () => {
    expect(html).toContain("跑過的藥局 · 3 家")
    expect(html).toContain("跑過的縣市 · 2 個縣市")
    expect(html).toContain("4 / 6")
    expect(html.match(/data-medal-id=/g)).toHaveLength(6)
  })

  it("每面下面寫門檻與狀態", () => {
    expect(html).toContain("5 家")
    expect(html).toContain("還差 2 家")
    expect(html).toContain("10/28 解鎖")
    expect(html).toContain("還差 1 個縣市")
  })

  it("3D 載好之前先畫平塗的獎牌（跑不動 WebGL 時就一直是它）", () => {
    expect(html.match(/data-flat-medal/g)).toHaveLength(6)
  })
})

describe("FlatMedal", () => {
  it("解鎖的有那一級的顏色與圖示，沒解鎖的是灰色加鎖", () => {
    const open = { ...medals[2], have: 5, unlocked_on: "2026-10-28", unlocked_at: at }
    const gold = renderToStaticMarkup(createElement(FlatMedal, { medal: open }))
    expect(gold).toContain("#FFC93C")
    const locked = renderToStaticMarkup(createElement(FlatMedal, { medal: medals[2] }))
    expect(locked).not.toContain("#FFC93C")
    expect(locked).toContain("data-lock")
  })
})
