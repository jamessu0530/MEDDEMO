import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const auth = vi.hoisted(() => ({ readUser: vi.fn() }))
vi.mock("@/lib/auth", () => auth)
import { captureInquiryLocation } from "@/lib/inquiry-location"

const geolocation = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() }
const fix = () =>
  ({
    coords: { latitude: 25.034, longitude: 121.5645, accuracy: 12 },
    timestamp: Date.now(),
  }) as GeolocationPosition

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-20T08:00:00Z"))
  auth.readUser.mockReturnValue({ id: "U01", role: "sales" })
  vi.stubGlobal("navigator", { geolocation })
  geolocation.getCurrentPosition.mockReset()
  geolocation.watchPosition.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("提問當下的一次性定位", () => {
  it("只取得一次新定位，之後移動或過時間都不會重查", async () => {
    geolocation.getCurrentPosition.mockImplementation((success) =>
      success(fix())
    )
    const result = await captureInquiryLocation(new AbortController().signal)
    expect(result).toMatchObject({
      lat: 25.034,
      lng: 121.5645,
      accuracy_m: 12,
      captured_at: "2026-10-20T08:00:00.000Z",
    })
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { maximumAge: 0, timeout: 4000, enableHighAccuracy: true }
    )
    await vi.advanceTimersByTimeAsync(600_000)
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(geolocation.watchPosition).not.toHaveBeenCalled()
  })
  it("拒絕、逾時、無定位功能時仍讓提問繼續", async () => {
    geolocation.getCurrentPosition.mockImplementation((_success, fail) =>
      fail({ code: 1 })
    )
    expect(
      await captureInquiryLocation(new AbortController().signal)
    ).toBeUndefined()
    geolocation.getCurrentPosition.mockImplementation(() => {})
    const timeout = captureInquiryLocation(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(4500)
    expect(await timeout).toBeUndefined()
    vi.stubGlobal("navigator", {})
    expect(
      await captureInquiryLocation(new AbortController().signal)
    ).toBeUndefined()
  })
  it("拒絕舊快取、未來定位與無效座標", async () => {
    for (const value of [
      { ...fix(), timestamp: Date.now() - 120_000 },
      { ...fix(), timestamp: Date.now() + 120_000 },
      { ...fix(), coords: { ...fix().coords, latitude: NaN } },
    ]) {
      geolocation.getCurrentPosition.mockImplementation((success) =>
        success(value)
      )
      expect(
        await captureInquiryLocation(new AbortController().signal)
      ).toBeUndefined()
    }
  })
  it("取消後忽略遲到的定位；主管與 IT 不會要求定位", async () => {
    let late: PositionCallback | undefined
    geolocation.getCurrentPosition.mockImplementation((success) => {
      late = success
    })
    const controller = new AbortController()
    const result = captureInquiryLocation(controller.signal)
    controller.abort()
    late?.(fix())
    expect(await result).toBeUndefined()
    geolocation.getCurrentPosition.mockClear()
    for (const role of ["manager", "it"]) {
      auth.readUser.mockReturnValue({ role })
      expect(
        await captureInquiryLocation(new AbortController().signal)
      ).toBeUndefined()
    }
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })
})
