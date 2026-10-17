import { describe, expect, it, vi } from "vitest"
import { animateReportNumber } from "@/lib/report-number-animation"

function scheduler() {
  let time = 0
  let id = 0
  const pending = new Map<number, (time: number) => void>()
  return {
    now: () => time,
    request: (callback: (time: number) => void) => {
      pending.set(++id, callback)
      return id
    },
    cancel: (key: number) => {
      pending.delete(key)
    },
    step(next: number) {
      time = next
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((callback) => callback(time))
    },
    pending,
  }
}

describe("報表數字跳動", () => {
  it("保留瀏覽器動畫 API 的呼叫對象", () => {
    const browser = {
      requestAnimationFrame: vi.fn(function (this: unknown) {
        expect(this).toBe(browser)
        return 7
      }),
      cancelAnimationFrame: vi.fn(function (this: unknown, id: number) {
        expect(this).toBe(browser)
        expect(id).toBe(7)
      }),
    }
    vi.stubGlobal("window", browser)
    try {
      const stop = animateReportNumber(1, 2, () => {})
      stop()
      expect(browser.requestAnimationFrame).toHaveBeenCalledOnce()
      expect(browser.cancelAnimationFrame).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it.each([
    [100, 1000],
    [1000, 50],
    [25, -40],
    [0, 0.325],
  ])("從 %s 平順更新到 %s，最後精確抵達新值", (from, to) => {
    const clock = scheduler()
    const values: number[] = []
    animateReportNumber(from, to, (value) => values.push(value), clock)
    expect(values).toEqual([from])
    clock.step(160)
    clock.step(320)
    expect(values.at(-1)).not.toBe(to)
    expect(
      values.every(
        (value) => value >= Math.min(from, to) && value <= Math.max(from, to)
      )
    ).toBe(true)
    clock.step(640)
    expect(values.at(-1)).toBe(to)
    expect(clock.pending.size).toBe(0)
  })
  it("快速變更條件時取消前一個動畫，保留目前的數字接續跳動", () => {
    const clock = scheduler()
    let displayed = 100
    const stop = animateReportNumber(
      100,
      1000,
      (value) => {
        displayed = value
      },
      clock
    )
    clock.step(200)
    const midway = displayed
    stop()
    clock.step(300)
    expect(displayed).toBe(midway)
    animateReportNumber(
      midway,
      -50,
      (value) => {
        displayed = value
      },
      clock
    )
    clock.step(940)
    expect(displayed).toBe(-50)
  })
})
