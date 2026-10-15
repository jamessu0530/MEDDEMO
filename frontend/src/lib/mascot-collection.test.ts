import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Mascot } from "@/components/mascot"
import { AvatarStore } from "@/lib/avatars"
import { DEFAULT_MASCOT_LOOK, MASCOT_COLORS, MASCOT_OUTFITS, mascotPalette, type MascotLook } from "@/lib/mascot-collection"

describe("熊熊滾的異色與服裝", () => {
  it("異色替換身體、耳內和臉部色彩，原本的輪廓一致", () => {
    const render = (look: MascotLook) => renderToStaticMarkup(createElement(Mascot, { look }))
    for (const palette of MASCOT_COLORS) {
      const svg = render({ ...DEFAULT_MASCOT_LOOK, color: palette.id })
      expect(svg).toContain(`fill="${palette.base}"`)
      expect(svg).toContain(`fill="${palette.light}"`)
      expect(svg).toContain(`fill="${palette.ink}"`)
      expect(svg).toContain("M56 118 C56 80 84 56 120 56")
    }
    expect(mascotPalette("missing").id).toBe("classic")
  })
  it("所有服裝都可以配異色，也能用在頭像", () => {
    for (const outfit of MASCOT_OUTFITS.filter((item) => item.id !== "none")) {
      const svg = renderToStaticMarkup(createElement(Mascot, { look: { color: "mint", outfit: outfit.id }, bust: true }))
      expect(svg).toContain(`data-costume="${outfit.id}"`)
      expect(svg).toContain('viewBox="24 16 192 192"')
      expect(svg).not.toContain("mascot-shadow")
    }
  })
  it("頭像選擇立即更新，換照片或換帳號會清掉熊熊頭像", () => {
    const store = new AvatarStore()
    store.replace({ U01: "/old.jpg" }, { U01: { color: "mint", outfit: "beret" } })
    expect(store.mascotOf("U01")?.color).toBe("mint")
    store.updateMascot("U01", { color: "gold", outfit: "scarf" })
    expect(store.mascotOf("U01")?.color).toBe("gold")
    store.update("U01", "/new.jpg")
    expect(store.mascotOf("U01")).toBeNull()
    store.replace({})
    expect(store.urlOf("U01")).toBeNull()
  })
})
