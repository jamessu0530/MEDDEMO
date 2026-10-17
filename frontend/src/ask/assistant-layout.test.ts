import { describe, expect, it } from "vitest"
import {
  assistantLayout,
  assistantPanelSize,
  resizeAssistantPanel,
} from "./assistant-layout"

describe("拖曳對話框", () => {
  it("預設高度留下頁面總覽的可見空間", () => {
    expect(
      assistantPanelSize({ availableHeight: 800, collapsedHeight: 88 }).height
    ).toBe(384)
  })

  it("向上拉出紀錄，往下拉回輸入列就收合", () => {
    expect(
      resizeAssistantPanel({
        height: 260,
        availableHeight: 800,
        collapsedHeight: 88,
      })
    ).toEqual({ open: true, height: 260 })
    expect(
      resizeAssistantPanel({
        height: 128,
        availableHeight: 800,
        collapsedHeight: 88,
      }).open
    ).toBe(false)
    expect(
      resizeAssistantPanel({
        height: 129,
        availableHeight: 800,
        collapsedHeight: 88,
      })
    ).toEqual({ open: true, height: 184 })
  })
  it("原尺寸的 54px 輸入列使用量到的高度，第一次按向上即可展開", () => {
    expect(resizeAssistantPanel({ height: 54 + 48, availableHeight: 420, collapsedHeight: 54 }))
      .toEqual({ open: true, height: 214 })
  })

  it("鍵盤升起時限制高度，收起後能恢復使用者拉出的高度", () => {
    const args = { height: 600, collapsedHeight: 88 }
    expect(assistantPanelSize({ ...args, availableHeight: 320 }).height).toBe(
      296
    )
    expect(assistantPanelSize({ ...args, availableHeight: 800 }).height).toBe(
      600
    )
  })

  it("鍵盤上方只剩 320px 時，首次展開也留下能閱讀的對話紀錄", () => {
    const size = assistantPanelSize({ availableHeight: 320, collapsedHeight: 88 })
    expect(size.height).toBe(296)
    expect(size.min).toBe(248)
    // 頁首約 52px，加上含把手的收合輸入列，仍有超過 150px 可捲動。
    expect(size.height - 88 - 52).toBeGreaterThanOrEqual(150)
  })

  it("極小的可見空間以視窗為上限，不會因最小高度而溢出", () => {
    expect(
      assistantPanelSize({
        height: 400,
        availableHeight: 160,
        collapsedHeight: 88,
      }).height
    ).toBe(136)
    expect(
      assistantPanelSize({ availableHeight: 0, collapsedHeight: 88 }).height
    ).toBe(0)
  })
})

describe("手機助理的可見空間", () => {
  it("底部輸入欄保留分頁列的操作空間", () => {
    expect(
      assistantLayout({
        layoutHeight: 844,
        footers: [{ top: 764, bottom: 844 }],
      })
    ).toEqual({ inset: 80, availableHeight: 764 })
  })

  it("鍵盤打開且 Safari 平移畫面時，面板高度仍不超過可見範圍", () => {
    expect(
      assistantLayout({
        layoutHeight: 844,
        viewport: { height: 320, offsetTop: 96 },
        footers: [{ top: 764, bottom: 844 }],
      })
    ).toEqual({ inset: 428, availableHeight: 320 })
  })

  it("展開面板使用鍵盤上方的空間，不再額外扣掉頁面輸入列", () => {
    expect(
      assistantLayout({
        layoutHeight: 844,
        viewport: { height: 400, offsetTop: 0 },
      })
    ).toEqual({ inset: 444, availableHeight: 400 })
  })

  it("可見範圍內的固定操作列也會扣除高度", () => {
    expect(
      assistantLayout({
        layoutHeight: 844,
        viewport: { height: 400, offsetTop: 80 },
        footers: [{ top: 430, bottom: 480 }],
      })
    ).toEqual({ inset: 414, availableHeight: 350 })
  })

  it("鍵盤收起後還原高度，並支援沒有 visualViewport 的瀏覽器", () => {
    expect(assistantLayout({ layoutHeight: 844, viewport: null })).toEqual({
      inset: 0,
      availableHeight: 844,
    })
  })

  it("固定操作列的掃描順序不改變避讓結果", () => {
    const footers = [
      { top: 600, bottom: 764 },
      { top: 680, bottom: 764 },
    ]
    const args = {
      layoutHeight: 844,
    }
    expect(assistantLayout({ ...args, footers })).toEqual(
      assistantLayout({ ...args, footers: [...footers].reverse() })
    )
  })
})
