import { describe, expect, it } from "vitest"

import { mascotEyeOpenness } from "@/lib/mascot-blink"

describe("熊熊滾的立體眨眼", () => {
  it("待機時連眨兩下，中間完全睜眼，並在下一輪重複", () => {
    expect(mascotEyeOpenness(0)).toBe(1)
    expect(mascotEyeOpenness(2.492)).toBeCloseTo(.06)
    expect(mascotEyeOpenness(2.632)).toBeCloseTo(1)
    expect(mascotEyeOpenness(2.772)).toBeCloseTo(.06)
    expect(mascotEyeOpenness(5.6 + 2.492)).toBeCloseTo(.06)
  })

  it("主動眨眼立即開始，平滑開合，結束後回到睜眼", () => {
    expect(mascotEyeOpenness(.22, true)).toBeCloseTo(.06)
    expect(mascotEyeOpenness(.5, true)).toBeCloseTo(.06)
    const halfOpen = mascotEyeOpenness(.16, true)
    expect(halfOpen).toBeGreaterThan(.06)
    expect(halfOpen).toBeLessThan(1)
    expect(mascotEyeOpenness(.8, true)).toBe(1)
    expect(mascotEyeOpenness(2.4 + .22, true)).toBeCloseTo(.06)
  })
})
