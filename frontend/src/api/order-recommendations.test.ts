import { afterEach, expect, it, vi } from "vitest"
import { getOrderRecommendations } from "@/api/orders"

afterEach(() => vi.unstubAllGlobals())

it("客戶推薦正確編碼客戶與多個已選料號，並傳遞取消訊號", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), {
      headers: { "Content-Type": "application/json" },
    })
  )
  vi.stubGlobal("fetch", fetch)
  const controller = new AbortController()
  await getOrderRecommendations("客戶/一", ["P&1", "P 2"], controller.signal)
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit]
  expect(url.split("?")[0]).toBe(
    "/api/orders/customers/%E5%AE%A2%E6%88%B6%2F%E4%B8%80/recommendations"
  )
  expect(
    new URL(url, "https://example.test").searchParams.getAll("exclude_sku")
  ).toEqual(["P&1", "P 2"])
  expect(options.signal).toBe(controller.signal)
})
