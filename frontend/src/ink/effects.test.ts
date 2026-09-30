import { describe, expect, it } from "vitest"

import { BLEED, bleedLead, INK_DURATION, inkColors, pickEffect } from "@/ink/effects"

describe("pickEffect", () => {
  it("底部分頁之間是墨暈", () => {
    expect(pickEffect("/", "/customers")).toBe("bleed")
    expect(pickEffect("/ask", "/promotions")).toBe("bleed")
    expect(pickEffect("/channels", "/")).toBe("bleed")
  })

  it("進入或返回內頁是刷痕", () => {
    expect(pickEffect("/customers", "/customers/c-12")).toBe("brush")
    expect(pickEffect("/customers/c-12", "/customers/c-12/quote")).toBe("brush")
    expect(pickEffect("/settings", "/")).toBe("brush")
    expect(pickEffect("/manager", "/settings")).toBe("brush")
    expect(pickEffect("/channels", "/channels/7")).toBe("brush")
  })

  it("進出登入那幾頁是潑墨，登入頁之間互換是刷痕", () => {
    expect(pickEffect("/login", "/")).toBe("splat")
    expect(pickEffect("/register", "/manager")).toBe("splat")
    expect(pickEffect("/settings", "/login")).toBe("splat")
    expect(pickEffect("/auth/github/callback", "/")).toBe("splat")
    expect(pickEffect("/login", "/register")).toBe("brush")
  })

  it("同一頁不播，結尾多一條斜線也算同一頁", () => {
    expect(pickEffect("/manager", "/manager")).toBeNull()
    expect(pickEffect("/customers/", "/customers")).toBeNull()
    expect(pickEffect("/", "/")).toBeNull()
  })
})

describe("INK_DURATION", () => {
  it("每天按最多次的分頁切換最短，很少發生的換配色最長", () => {
    expect(INK_DURATION.bleed).toBeLessThan(INK_DURATION.brush)
    expect(INK_DURATION.brush).toBeLessThan(INK_DURATION.splat)
    expect(INK_DURATION.splat).toBeLessThan(INK_DURATION.spray)
    expect(INK_DURATION.bleed).toBeLessThanOrEqual(700)
  })
})

describe("inkColors", () => {
  it("同一個配色裡，墨從主色走到同色系較深或較淺的顏色", () => {
    const purple = inkColors("purple")
    expect(purple.from).toEqual([0x9b / 255, 0x51 / 255, 0xe0 / 255])
    expect(purple.to).not.toEqual(purple.from)
    expect(purple.washFrom).toEqual(purple.washTo)

    const mono = inkColors("mono")
    // 黑白灰的墨三個色版一樣，沒有顏色
    for (const color of [mono.from, mono.to, mono.washFrom]) {
      expect(Math.max(...color) - Math.min(...color)).toBeLessThan(0.02)
    }
  })

  it("換配色那一次，從舊配色的主色染到新配色的主色", () => {
    const colors = inkColors("purple", "mono")
    expect(colors.from).toEqual(inkColors("purple").from)
    expect(colors.to).toEqual(inkColors("mono").from)
    expect(colors.washFrom).toEqual(inkColors("purple").washFrom)
    expect(colors.washTo).toEqual(inkColors("mono").washFrom)
  })
})

describe("bleedLead", () => {
  it("前緣一路往外，不會倒退", () => {
    let last = -Infinity
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const lead = bleedLead(Math.min(t, 1))
      expect(lead).toBeGreaterThanOrEqual(last)
      last = lead
    }
  })

  it("一開始畫面上沒有墨，連飛在前面的墨點都還沒出來", () => {
    expect(bleedLead(0) + BLEED.dropsAhead).toBeLessThanOrEqual(0)
  })

  it("換頁那一刻前緣已經過了最遠的角落，後緣還沒從起點出來", () => {
    const lead = bleedLead(0.5)
    expect(lead - BLEED.leadWobble).toBeGreaterThanOrEqual(1)
    // 後緣最先出現在起點，那裡最多被雜訊往前推 trailWobbleAtOrigin
    expect(lead - BLEED.band + BLEED.thin + BLEED.trailWobbleAtOrigin).toBeLessThanOrEqual(0)
  })

  it("結束時後緣也過了最遠的角落", () => {
    expect(bleedLead(1) - BLEED.band - BLEED.trailWobble).toBeGreaterThanOrEqual(1)
  })
})
