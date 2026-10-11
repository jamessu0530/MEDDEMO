import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createMethod,
  getMethodSource,
  listMethodSources,
  updateMethod,
  type MethodCardInput,
} from "@/api/methods"

afterEach(() => vi.unstubAllGlobals())

const input: MethodCardInput = {
  title: "先確認付款日",
  situation: "帳款已逾期時",
  approach: "先整理對帳明細，再聯繫老闆。",
  customer_type: null,
  tags: ["ar_overdue"],
}
function respond(body: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  vi.stubGlobal("fetch", fetch)
  return fetch
}

describe("方法卡來源 API", () => {
  it("跨頻道搜索正確編碼關鍵字與游標，傳遞 AbortSignal", async () => {
    const fetch = respond({ items: [], next_before: null })
    const controller = new AbortController()
    await listMethodSources(
      { q: "  付款 & 拜訪  ", channel_id: 8, before: 42, limit: 20 },
      controller.signal
    )
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit]
    const query = new URL(url, "https://example.test").searchParams
    expect(url.split("?")[0]).toBe("/api/methods/sources")
    expect(query.get("q")).toBe("付款 & 拜訪")
    expect(query.get("channel_id")).toBe("8")
    expect(query.get("before")).toBe("42")
    expect(query.get("limit")).toBe("20")
    expect(options.signal).toBe(controller.signal)
  })

  it("沒有頻道篩選時查所有可見來源，空關鍵字不附多餘參數", async () => {
    const fetch = respond({ items: [], next_before: null })
    await listMethodSources({ q: "  " })
    expect(fetch.mock.calls[0][0]).toBe("/api/methods/sources")
  })

  it("單筆來源請求仍帶 signal", async () => {
    const fetch = respond({ message_id: 42 })
    const controller = new AbortController()
    await getMethodSource(42, controller.signal)
    expect(fetch.mock.calls[0][0]).toBe("/api/methods/sources/42")
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it("新增可帶來源，修改未碰來源時省略，移除傳 null", async () => {
    let fetch = respond({ id: 1 })
    await createMethod({ ...input, source_message_id: 42 })
    expect(JSON.parse(fetch.mock.calls[0][1].body).source_message_id).toBe(42)
    fetch = respond({ id: 1 })
    await updateMethod(1, input)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "source_message_id"
    )
    fetch = respond({ id: 1 })
    await updateMethod(1, { source_message_id: null })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      source_message_id: null,
    })
  })
})
