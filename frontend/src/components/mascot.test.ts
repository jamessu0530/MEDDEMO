import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Mascot, MascotFigure } from "@/components/mascot"
import { voiceMascotState, type MascotState } from "@/lib/mascot"

const render = (props: Parameters<typeof Mascot>[0] = {}) => renderToStaticMarkup(createElement(Mascot, props))

describe("Mascot", () => {
  it("預設是待機、裝飾用，整隻都畫出來", () => {
    const svg = render()
    expect(svg).toContain('class="mascot mascot-idle"')
    expect(svg).toContain('viewBox="0 0 240 240"')
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).toContain("mascot-shadow")
    expect(svg).toContain('data-eyes="open"')
    expect(svg).toContain('data-mouth="smile"')
  })

  it("每個狀態有自己的表情和道具", () => {
    const face: Record<MascotState, [string, string]> = {
      idle: ["open", "smile"], hi: ["happy", "open"], listen: ["open", "smile"], think: ["up", "hmm"],
      talk: ["open", "open"], wait: ["open", "smile"], yay: ["happy", "open"],
      ride: ["happy", "open"],
    }
    for (const [state, [eyes, mouth]] of Object.entries(face) as [MascotState, [string, string]][]) {
      const svg = render({ state })
      expect(svg, state).toContain(`mascot-${state}`)
      expect(svg, state).toContain(`data-eyes="${eyes}"`)
      expect(svg, state).toContain(`data-mouth="${mouth}"`)
    }
    expect(render({ state: "listen" }).match(/mascot-wave/g)).toHaveLength(2)
    expect(render({ state: "think" }).match(/mascot-dot/g)).toHaveLength(3)
    expect(render({ state: "wait" }).match(/mascot-load/g)).toHaveLength(3)
    expect(render({ state: "yay" }).match(/mascot-star/g)).toHaveLength(4)
    expect(render({ state: "idle" })).not.toMatch(/mascot-(wave|dot|load|star)/)
    expect(render({ state: "ride" })).not.toMatch(/mascot-(wave|dot|load|star)/)
  })

  it("半身特寫切到頭和肩膀，不畫影子", () => {
    const svg = render({ bust: true, size: 28 })
    expect(svg).toContain('viewBox="24 16 192 192"')
    expect(svg).toContain('width="28"')
    expect(svg).not.toContain("mascot-shadow")
  })

  it("旁邊沒有文字說明時，用 label 讓讀屏唸得出狀態", () => {
    const svg = render({ state: "wait", label: "正在整理拜訪紀錄" })
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="正在整理拜訪紀錄"')
    expect(svg).not.toContain("aria-hidden")
  })

  it("七個狀態加起來只用定案的那幾個顏色", () => {
    const states: MascotState[] = ["idle", "hi", "listen", "think", "talk", "wait", "yay", "ride"]
    const colors = new Set(states.flatMap((state) => render({ state }).match(/#[0-9A-Fa-f]{6}\b|#fff\b/g) ?? []))
    // 主色、淺紫、深色；舌頭；泡泡與聲波；星星；眼睛的反光
    expect([...colors].sort()).toEqual(["#2B1B47", "#9B51E0", "#C9A2F5", "#EADBFD", "#FF8FB3", "#FFC93C", "#fff"].sort())
  })
})

describe("MascotFigure", () => {
  it("MascotFigure 只有熊本身，可以疊到別的 svg 裡", () => {
    const g = renderToStaticMarkup(createElement("svg", null, createElement(MascotFigure, { state: "ride", props: false })))
    expect(g).toContain('class="mascot-all"')
    expect(g).toContain('data-eyes="happy"')
    expect(g).toContain('data-mouth="open"')
    expect(g).not.toContain("mascot-shadow")
    expect(g).not.toContain("<svg viewBox")
  })
})

describe("voiceMascotState", () => {
  it("AI 在講話就是回答，有查詢在跑是思考，其餘在聽", () => {
    expect(voiceMascotState("speaking", 0)).toBe("talk")
    expect(voiceMascotState("speaking", 2)).toBe("talk")
    expect(voiceMascotState("listening", 1)).toBe("think")
    expect(voiceMascotState("listening", 0)).toBe("listen")
  })
})
