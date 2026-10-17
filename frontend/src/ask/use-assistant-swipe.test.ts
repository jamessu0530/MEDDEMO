import { describe, expect, it } from "vitest"
import { assistantSwipe, assistantSwipeDistance, assistantSwipeProgress } from "@/ask/use-assistant-swipe"

describe("對話框隱藏手勢", () => {
  it("左往右啟用 Ghost，右往左開新對話", () => {
    expect(assistantSwipe(100, 12, 300)).toBe("ghost")
    expect(assistantSwipe(-100, 12, 300)).toBe("new")
  })
  it("小幅移動、垂直捲動、斜向捲動和長按不切換對話", () => {
    for (const [dx, dy, elapsed] of [
      [40, 0, 200],
      [10, 120, 200],
      [100, 80, 200],
      [0, 0, 2000],
    ]) {
      expect(assistantSwipe(dx, dy, elapsed)).toBeNull()
    }
  })
  it("像解鎖一樣可停留，不會因滑得慢而失效", () => {
    expect(assistantSwipe(100, 0, 5000)).toBe("ghost")
    expect(assistantSwipe(-100, 0, 5000)).toBe("new")
  })
  it.each(["ghost", "new"] as const)("%s 往回收會倒退進度，曾經滑到底也不能提前切換", (action) => {
    const distance = assistantSwipeDistance(360)
    const direction = action === "ghost" ? 1 : -1
    const steps = [0, .5, 1.2, .4, 0, -.1].map((position) => assistantSwipeProgress(action, position * distance * direction, distance))
    expect(steps).toEqual([0, .5, 1, .4, 0, 0])
  })
  it("依輸入框寬度設定解鎖距離，避免小幅滑動就誤開新對話", () => {
    expect(assistantSwipeDistance(100)).toBe(96)
    expect(assistantSwipeDistance(360)).toBeCloseTo(198)
    expect(assistantSwipeDistance(1000)).toBe(240)
    const distance = assistantSwipeDistance(360)
    expect(assistantSwipe(100, 0, 500, distance)).toBeNull()
    expect(assistantSwipe(200, 0, 500, distance)).toBe("ghost")
  })
})
