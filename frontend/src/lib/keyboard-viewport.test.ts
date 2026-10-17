import { describe, expect, it } from "vitest"
import { keyboardViewport } from "./keyboard-viewport"

const phone = { layoutHeight: 852, fullHeight: 852, width: 393, editing: true }

describe("全站手機鍵盤範圍", () => {
  it("iOS 只縮 visual viewport 時仍能辨識鍵盤", () => {
    expect(keyboardViewport({ ...phone, height: 462 })).toEqual({
      height: 462,
      top: 0,
      inset: 390,
      open: true,
    })
  })
  it("Safari 平移不會讓鍵盤底距重複扣除", () => {
    expect(keyboardViewport({ ...phone, height: 462, top: 64 }).inset).toBe(326)
  })
  it("Android 同時縮小 layout viewport 也會進入輸入版面", () => {
    expect(
      keyboardViewport({ ...phone, layoutHeight: 462, height: 462 })
    ).toEqual({
      height: 462,
      top: 0,
      inset: 0,
      open: true,
    })
  })
  it("工具列收合、縮放、桌機或沒有文字焦點時不當作鍵盤", () => {
    for (const args of [
      { ...phone, height: 800 },
      { ...phone, height: 462, scale: 2 },
      { ...phone, height: 462, width: 1280 },
      { ...phone, height: 462, editing: false },
    ])
      expect(keyboardViewport(args).open).toBe(false)
  })
  it("鍵盤關閉後恢復正常頁面", () => {
    expect(keyboardViewport(phone)).toEqual({
      height: 852,
      top: 0,
      inset: 0,
      open: false,
    })
  })
})
