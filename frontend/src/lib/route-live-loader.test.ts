import { describe, expect, it, vi } from "vitest"

import { RouteLiveLoader } from "@/lib/route-live-loader"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const actions = {
    full: vi
      .fn<(signal: AbortSignal) => Promise<number>>()
      .mockResolvedValue(2),
    locations: vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValue("位置"),
    onFull: vi.fn(),
    onLocations: vi.fn(),
    onError: vi.fn(),
  }
  return { actions, loader: new RouteLiveLoader(actions) }
}

describe("主管行程的請求合併", () => {
  it("載入中收到多次通知只補一次完整更新，不重疊請求", async () => {
    const { actions, loader } = setup()
    const first = deferred<number>()
    actions.full.mockImplementationOnce(() => first.promise)
    loader.reload("full")
    loader.reload("locations")
    loader.reload("full")
    loader.reload("locations")
    expect(actions.full).toHaveBeenCalledTimes(1)
    expect(actions.locations).not.toHaveBeenCalled()
    expect(actions.full.mock.calls[0][0].aborted).toBe(false)

    first.resolve(1)
    await vi.waitFor(() =>
      expect(actions.onFull.mock.calls).toEqual([[1], [2]])
    )
    expect(actions.full).toHaveBeenCalledTimes(2)
    expect(actions.locations).not.toHaveBeenCalled()
    loader.dispose()
  })

  it("先完成完整行程再合併最新位置，舊行程不會蓋過新位置", async () => {
    const { actions, loader } = setup()
    const first = deferred<number>()
    actions.full.mockImplementationOnce(() => first.promise)
    loader.reload("full")
    loader.reload("locations")
    expect(actions.locations).not.toHaveBeenCalled()
    first.resolve(1)
    await vi.waitFor(() =>
      expect(actions.onLocations).toHaveBeenCalledWith("位置")
    )
    expect(actions.onFull).toHaveBeenCalledWith(1)
    expect(actions.locations).toHaveBeenCalledTimes(1)
    loader.dispose()
  })

  it("位置載入失敗不影響後續完整更新", async () => {
    const { actions, loader } = setup()
    actions.locations.mockRejectedValueOnce(new Error("斷線"))
    loader.reload("locations")
    loader.reload("full")
    await vi.waitFor(() => expect(actions.onFull).toHaveBeenCalledWith(2))
    expect(actions.onError).not.toHaveBeenCalled()
    loader.dispose()
  })

  it("完整載入錯誤交給畫面處理，下一次仍能重新載入", async () => {
    const { actions, loader } = setup()
    const error = new Error("斷線")
    actions.full.mockRejectedValueOnce(error)
    loader.reload("full")
    await vi.waitFor(() => expect(actions.onError).toHaveBeenCalledWith(error))
    loader.reload("full")
    await vi.waitFor(() => expect(actions.onFull).toHaveBeenCalledWith(2))
    loader.dispose()
  })

  it("換頁後忽略舊請求的回應與排隊更新", async () => {
    const { actions, loader } = setup()
    const first = deferred<number>()
    actions.full.mockImplementationOnce(() => first.promise)
    loader.reload("full")
    loader.reload("locations")
    loader.dispose()
    first.resolve(1)
    await first.promise
    expect(actions.full.mock.calls[0][0].aborted).toBe(true)
    expect(actions.onFull).not.toHaveBeenCalled()
    expect(actions.locations).not.toHaveBeenCalled()
    loader.reload("full")
    expect(actions.full).toHaveBeenCalledTimes(1)
  })
})
