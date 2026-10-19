import { beforeEach, describe, expect, it, vi } from "vitest"
const client = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn() }))
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: client.request,
  upload: client.upload,
}))
import { createAsk } from "@/api/asks"
const location = {
  lat: 25.03,
  lng: 121.56,
  accuracy_m: 12,
  captured_at: "2026-10-20T08:00:00Z",
  place_name: null,
}
beforeEach(() => {
  client.request.mockReset()
  client.upload.mockReset()
})
describe("提問定位的傳輸", () => {
  it("一般提問把單次定位送到提問 API，沒有頁面情境也可以", async () => {
    await createAsk("data", "有哪些商品？", undefined, false, { location })
    const [url, options] = client.request.mock.calls[0]
    expect(url).toBe("/api/asks")
    expect(JSON.parse(options.body)).toMatchObject({
      question: "有哪些商品？",
      inquiry_location: location,
    })
  })
  it("附檔提問將同一份定位放進 multipart", async () => {
    await createAsk(
      "data",
      "這個賣多少？",
      new File(["box"], "box.txt"),
      false,
      { location }
    )
    const [url, form] = client.upload.mock.calls[0]
    expect(url).toBe("/api/asks")
    expect(JSON.parse(form.get("inquiry_location"))).toEqual(location)
  })
  it("Ghost 不論 JSON 或附檔都不傳定位或頁面情境", async () => {
    const context = {
      location,
      page: { path: "/customers/C01", title: "客戶檔案", facts: [] },
    }
    await createAsk("data", "暫時問題", undefined, true, context)
    const body = JSON.parse(client.request.mock.calls[0][1].body)
    expect(body.ghost).toBe(true)
    expect(body).not.toHaveProperty("inquiry_location")
    expect(body).not.toHaveProperty("page")
    await createAsk(
      "data",
      "暫時問題",
      new File(["box"], "box.txt"),
      true,
      context
    )
    expect(client.upload.mock.calls[0][1].has("inquiry_location")).toBe(false)
    expect(client.upload.mock.calls[0][1].has("page")).toBe(false)
  })
})
