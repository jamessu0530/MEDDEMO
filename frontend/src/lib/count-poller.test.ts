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

// demo 當天 50 個人同時發言，每支手機每則通知都問一次紅點的話，幾秒內就是幾千個請求，會把 API 的連線池擠爆
describe("CountPoller 合併請求", () => {
  it("一次只問一個；問的時候又要問，問完只補問一次", async () => {
    const pending: Array<(value: { count: number }) => void> = []
    const fetchCount = vi.fn(() => new Promise<{ count: number }>((resolve) => pending.push(resolve)))
    const poller = new CountPoller(fetchCount)

    const first = poller.refresh()
    for (let i = 0; i < 5; i++) void poller.refresh()
    expect(fetchCount).toHaveBeenCalledTimes(1)

    pending[0]({ count: 1 })
    await vi.advanceTimersByTimeAsync(0)
    // 問的時候又要了五次：只補一次，補的這次看得到這段時間的變動
    expect(fetchCount).toHaveBeenCalledTimes(2)
    pending[1]({ count: 2 })
    await first
    expect(fetchCount).toHaveBeenCalledTimes(2)
    expect(poller.getSnapshot()).toBe(2)

    // 都問完了，下一次照常馬上問
    void poller.refresh()
    expect(fetchCount).toHaveBeenCalledTimes(3)
  })

  it("即時通知等 2 秒再問，這段時間的通知併成一次", async () => {
    const fetchCount = vi.fn().mockResolvedValue({ count: 1 })
    const poller = new CountPoller(fetchCount)

    for (let i = 0; i < 50; i++) poller.refreshSoon()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchCount).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchCount).toHaveBeenCalledTimes(1)

    // 之後再來的通知再等 2 秒
    poller.refreshSoon()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchCount).toHaveBeenCalledTimes(2)
  })

  it("通知一直進來也不會一直往後延：至少每 2 秒問一次", async () => {
    const fetchCount = vi.fn().mockResolvedValue({ count: 1 })
    const poller = new CountPoller(fetchCount)

    for (let elapsed = 0; elapsed < 6_000; elapsed += 100) {
      poller.refreshSoon()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(fetchCount).toHaveBeenCalledTimes(3)
  })
})
