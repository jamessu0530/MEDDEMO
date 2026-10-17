import { afterEach, describe, expect, it, vi } from "vitest"
import { layoutCalendar, type CalendarLayoutInput } from "./calendar-layout"
import {
  createCalendarLayoutRunner,
  type CalendarLayoutResponse,
  type CalendarLayoutWorker,
} from "./calendar-layout-runner"

const input: CalendarLayoutInput = {
  days: ["2026-10-17"],
  events: [
    {
      id: "a",
      starts_at: "2026-10-17T01:00:00Z",
      ends_at: "2026-10-17T02:00:00Z",
      timezone: "Asia/Taipei",
      all_day: false,
    },
  ],
}
const layout = layoutCalendar(input)
function fakeWorker() {
  const worker: CalendarLayoutWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  return {
    worker,
    reply(id: number) {
      worker.onmessage?.call(
        worker as Worker,
        { data: { id, layout } } as MessageEvent<CalendarLayoutResponse>
      )
    },
    fail() {
      worker.onerror?.call(
        worker as Worker,
        { preventDefault: vi.fn() } as unknown as ErrorEvent
      )
    },
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("日曆 worker 生命週期", () => {
  it("重用 worker 並合併連續切換，舊結果不能覆蓋最新日期", () => {
    const fake = fakeWorker(),
      create = vi.fn(() => fake.worker),
      onResult = vi.fn()
    const runner = createCalendarLayoutRunner(onResult, vi.fn(), create)
    runner.update(input)
    runner.update({ ...input, days: ["2026-10-18"] })
    runner.update(input)
    expect(create).toHaveBeenCalledTimes(1)
    expect(fake.worker.postMessage).toHaveBeenCalledTimes(1)
    fake.reply(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(fake.worker.postMessage).toHaveBeenLastCalledWith({ id: 3, input })
    fake.reply(1)
    expect(onResult).not.toHaveBeenCalled()
    fake.reply(3)
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layout, input)
    runner.dispose()
  })

  it("worker 訊息只帶時間欄位；回傳保留原始輸入供畫面對應", () => {
    const fake = fakeWorker(),
      onResult = vi.fn()
    const runner = createCalendarLayoutRunner(
      onResult,
      vi.fn(),
      () => fake.worker
    )
    const withContent = {
      ...input,
      events: input.events.map((event) => ({
        ...event,
        description: "長備註",
        attendees: ["a@example.com"],
      })),
    }
    runner.update(withContent)
    expect(fake.worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      input,
    })
    fake.reply(1)
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layout, withContent)
    runner.dispose()
  })

  it("離開頁面取消佇列並釋放 worker，在途回覆不再更新畫面", () => {
    const fake = fakeWorker(),
      onResult = vi.fn()
    const runner = createCalendarLayoutRunner(
      onResult,
      vi.fn(),
      () => fake.worker
    )
    runner.update(input)
    runner.update(input)
    const late = fake.worker.onmessage
    runner.dispose()
    late?.call(
      fake.worker as Worker,
      { data: { id: 1, layout } } as MessageEvent<CalendarLayoutResponse>
    )
    runner.update(input)
    expect(fake.worker.terminate).toHaveBeenCalledTimes(1)
    expect(fake.worker.onmessage).toBeNull()
    expect(fake.worker.postMessage).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
  })

  it.each(["load", "decode"])(
    "worker %s 失敗時分批重算最新請求",
    async (failure) => {
      vi.useFakeTimers()
      const fake = fakeWorker(),
        onResult = vi.fn(),
        onError = vi.fn()
      const runner = createCalendarLayoutRunner(
        onResult,
        onError,
        () => fake.worker
      )
      runner.update({ ...input, events: [] })
      runner.update(input)
      if (failure === "load") fake.fail()
      else
        fake.worker.onmessageerror?.call(
          fake.worker as Worker,
          {} as MessageEvent
        )
      expect(onResult).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(onResult).toHaveBeenCalledExactlyOnceWith(layout, input)
      expect(onError).not.toHaveBeenCalled()
      expect(fake.worker.terminate).toHaveBeenCalledTimes(1)
      runner.dispose()
    }
  )

  it("不支援 worker 時仍套用最新請求，取消後不再回傳", async () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const runner = createCalendarLayoutRunner(onResult, vi.fn(), () => {
      throw new Error("unavailable")
    })
    runner.update({ ...input, events: [] })
    runner.update(input)
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layout, input)
    runner.update(input)
    runner.dispose()
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it("傳送失敗時降級，錯誤資料則回報而不會一直顯示整理中", async () => {
    vi.useFakeTimers()
    const fake = fakeWorker(),
      onResult = vi.fn(),
      onError = vi.fn()
    vi.mocked(fake.worker.postMessage).mockImplementation(() => {
      throw new Error("cannot clone")
    })
    const runner = createCalendarLayoutRunner(
      onResult,
      onError,
      () => fake.worker
    )
    runner.update(input)
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layout, input)
    const invalid = {
      ...input,
      events: [{ ...input.events[0], starts_at: "invalid" }],
    }
    runner.update(invalid)
    await vi.runAllTimersAsync()
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), invalid)
    runner.dispose()
  })
})
