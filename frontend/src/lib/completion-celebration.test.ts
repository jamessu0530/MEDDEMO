import { afterEach, describe, expect, it, vi } from "vitest"

import { celebrateCompletion, completionCelebration, dismissCompletion } from "@/lib/completion-celebration"

afterEach(() => {
  const event = completionCelebration.getSnapshot()
  if (event) dismissCompletion(event.id)
})

describe("completion celebration", () => {
  it("publishes a saved completion and clears it when the animation finishes", () => {
    const listener = vi.fn()
    const unsubscribe = completionCelebration.subscribe(listener)
    expect(completionCelebration.getSnapshot()).toBeNull()
    celebrateCompletion("拜訪紀錄回寫完成！")
    const event = completionCelebration.getSnapshot()!
    expect(event.message).toBe("拜訪紀錄回寫完成！")
    expect(listener).toHaveBeenCalledTimes(1)
    dismissCompletion(event.id)
    expect(completionCelebration.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    celebrateCompletion("闖關成功！")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("restarts on consecutive completions without an old timer hiding the new one", () => {
    celebrateCompletion("闖關成功！")
    const first = completionCelebration.getSnapshot()!
    celebrateCompletion("闖關成功！")
    const second = completionCelebration.getSnapshot()!
    expect(second.id).not.toBe(first.id)
    dismissCompletion(first.id)
    expect(completionCelebration.getSnapshot()).toBe(second)
    dismissCompletion(second.id)
    expect(completionCelebration.getSnapshot()).toBeNull()
  })
})
