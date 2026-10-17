import { describe, expect, it } from "vitest"
import { scrollHeader, type ScrollHeaderState } from "./scroll-header"

const shown: ScrollHeaderState = { position: 100, travel: 0, hidden: false }

describe("商品與促銷頁首自動收合", () => {
  it("向下閱讀時累積捲動後收起，反向滑動才重新顯示", () => {
    let state = shown
    for (const position of [108, 116, 124])
      state = scrollHeader(state, position, 1000)
    expect(state.hidden).toBe(true)
    state = scrollHeader(state, 118, 1000)
    expect(state.hidden).toBe(true)
    state = scrollHeader(state, 108, 1000)
    expect(state.hidden).toBe(false)
  })

  it("小幅來回移動不會反覆閃動", () => {
    for (const hidden of [false, true]) {
      let state = { ...shown, hidden }
      for (const position of [104, 101, 105, 100, 104, 99, 100])
        state = scrollHeader(state, position, 1000)
      expect(state.hidden).toBe(hidden)
    }
  })

  it("滑到頂端、回彈與沒有捲動空間時顯示工具列", () => {
    const hidden = { ...shown, hidden: true }
    for (const position of [16, 0, -40])
      expect(scrollHeader(hidden, position, 1000).hidden).toBe(false)
    expect(scrollHeader(hidden, 100, 0).hidden).toBe(false)
  })

  it("捲到底之後的回彈不會讓頁首突然展開", () => {
    let state = { position: 1000, travel: 0, hidden: true }
    for (const position of [1040, 1080, 1030, 1000])
      state = scrollHeader(state, position, 1000)
    expect(state.hidden).toBe(true)
    expect(state.travel).toBe(0)
  })

  it("清單縮短時的瀏覽器位置修正不算反向滑動", () => {
    expect(
      scrollHeader({ position: 1500, travel: 0, hidden: true }, 1000, 1000)
        .hidden
    ).toBe(true)
  })

  it("搜尋欄或頁首按鈕有焦點時保留操作區", () => {
    expect(scrollHeader({ ...shown, hidden: true }, 400, 1000, true)).toEqual({
      position: 400,
      travel: 0,
      hidden: false,
    })
  })

  it("頁首原本的位置尚未捲完前不提前收起，避免留下大片空白", () => {
    expect(scrollHeader(shown, 200, 1000, false, 240).hidden).toBe(false)
    expect(
      scrollHeader(
        { position: 240, travel: 0, hidden: false },
        280,
        1000,
        false,
        240
      ).hidden
    ).toBe(true)
  })
})
