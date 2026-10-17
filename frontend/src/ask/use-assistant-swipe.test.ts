import { describe, expect, it } from "vitest"
import { assistantSwipe } from "@/ask/use-assistant-swipe"

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
      [100, 0, 2000],
    ]) {
      expect(assistantSwipe(dx, dy, elapsed)).toBeNull()
    }
  })
})
