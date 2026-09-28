import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CountPoller } from "@/lib/count-poller"

// vite.config.ts 的測試環境是 node（只測純邏輯模組），沒有 document／window／navigator；
// CountPoller 靠它們判斷分頁在不在背景、有沒有網路，還會掛 visibilitychange／online 監聽，
// 用 vi.stubGlobal 補最小的假物件，測完用 vi.unstubAllGlobals 拆掉，不影響其他測試檔
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal("navigator", { onLine: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("CountPoller", () => {
  it("第一個訂閱就先問一次，並開始每分鐘輪詢", async () => {
    const fetchCount = vi.fn().mockResolvedValue({ count: 3 })
    const poller = new CountPoller(fetchCount)

    poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCount).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchCount).toHaveBeenCalledTimes(2)
  })

  it("數字沒變就不通知聽眾，變了才通知並更新快照", async () => {
    const fetchCount = vi.fn().mockResolvedValue({ count: 0 })
    const poller = new CountPoller(fetchCount)
    const listener = vi.fn()

    poller.subscribe(listener)
    await vi.advanceTimersByTimeAsync(0)
    // 初始快照本來就是 0，第一次問到的也是 0，數字沒變不通知
    expect(listener).not.toHaveBeenCalled()

    fetchCount.mockResolvedValue({ count: 5 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(poller.getSnapshot()).toBe(5)

    // 下一輪問到的數字沒變，不再通知
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("最後一個訂閱者取消後停止輪詢", async () => {
    const fetchCount = vi.fn().mockResolvedValue({ count: 1 })
    const poller = new CountPoller(fetchCount)

    const unsubscribe = poller.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCount).toHaveBeenCalledTimes(1)

    unsubscribe()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchCount).toHaveBeenCalledTimes(1)
  })
})
