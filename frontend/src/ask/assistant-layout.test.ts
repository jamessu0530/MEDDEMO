import { describe, expect, it } from "vitest"
import { assistantLayout } from "./assistant-layout"

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
