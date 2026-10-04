import { describe, expect, it } from "vitest"

import { drawPlan, revealed, stopsShown } from "@/lib/route-draw"

// 赤道上：經度差 1 度就是 1 個單位，好算
const legs = [
  { done: true, pieces: [{ walk: false, path: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }] },
  {
    done: false,
    pieces: [
      { walk: true, path: [{ lat: 0, lng: 1 }, { lat: 0, lng: 1.5 }] },
      { walk: false, path: [{ lat: 0, lng: 1.5 }, { lat: 0, lng: 3 }] },
    ],
  },
]

describe("路線一段一段畫出來", () => {
  const plan = drawPlan(legs)

  it("整條路線攤成一條長度，記下每一段路畫完時筆在哪", () => {
    expect(plan.total).toBeCloseTo(3)
    expect(plan.legEnds.map((end) => Number(end.toFixed(6)))).toEqual([1, 3])
    expect(plan.pieces.map((piece) => [piece.leg, piece.walk, piece.done])).toEqual([
      [0, false, true],
      [1, true, false],
      [1, false, false],
    ])
  })

  it("每一小段只畫筆走過的部分，走到一半的那一點用內插", () => {
    expect(revealed(plan.pieces[0], 0)).toEqual([])
    expect(revealed(plan.pieces[0], 0.5)).toEqual([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.5 }])
    expect(revealed(plan.pieces[0], 2)).toEqual(legs[0].pieces[0].path)
    expect(revealed(plan.pieces[1], 0.5)).toEqual([])
    const riding = revealed(plan.pieces[2], 2)
    expect(riding).toHaveLength(2)
    expect(riding[1].lng).toBeCloseTo(2)
  })

  it("筆走到哪一站，那一站的圓點才出來；沒有出發點時第 1 站一開始就在", () => {
    expect([0, 1, 2.9, 3].map((pen) => stopsShown(plan, pen, true, 2))).toEqual([0, 1, 1, 2])
    expect(stopsShown(plan, 0, false, 3)).toBe(1)
    expect(stopsShown(plan, 3, false, 3)).toBe(3)
  })

  it("沒有路線（只有一站）就沒有東西要畫", () => {
    const empty = drawPlan([])
    expect(empty.total).toBe(0)
    expect(stopsShown(empty, 0, false, 1)).toBe(1)
  })
})
