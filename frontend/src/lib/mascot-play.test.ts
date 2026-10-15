import { describe, expect, it } from "vitest"

import { EMPTY_MASCOT_TAPS, MASCOT_TAP_WINDOW_MS, tapMascot } from "@/lib/mascot-play"

describe("熊熊滾戳戳彩蛋", () => {
  it("連續六下才分裂，分裂後不再累積", () => {
    let state = EMPTY_MASCOT_TAPS
    for (let count = 1; count <= 5; count++) {
      state = tapMascot(state, count * 100)
      expect(state.split).toBe(false)
    }
    state = tapMascot(state, 600)
    expect(state).toMatchObject({ count: 6, split: true })
    expect(tapMascot(state, 700)).toBe(state)
  })

  it("間隔太久重新計數，第一下在時間零也算數", () => {
    const first = tapMascot(EMPTY_MASCOT_TAPS, 0)
    expect(tapMascot(first, 100).count).toBe(2)
    expect(tapMascot(first, MASCOT_TAP_WINDOW_MS)).toMatchObject({ count: 1, split: false })
  })
})
