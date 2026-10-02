import { afterEach, describe, expect, it, vi } from "vitest"

import { request } from "@/api/client"

function respond(status: number, body: string, contentType = "application/json") {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status, headers: { "Content-Type": contentType } })))
}

async function failure(path = "/api/itinerary/today/ask") {
  return request(path, { method: "POST" }).then(
    () => expect.unreachable(),
    (error: Error) => error.message
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("request 的錯誤訊息", () => {
  it("後端有說明就照說明顯示", async () => {
    respond(502, JSON.stringify({ detail: "熊熊滾這次沒聽懂，請換個說法再試一次" }))
    expect(await failure()).toBe("熊熊滾這次沒聽懂，請換個說法再試一次")
  })

  it("閘道回的錯誤頁沒有說明，不顯示狀態碼", async () => {
    respond(502, "<html>502 Bad Gateway</html>", "text/html")
    expect(await failure()).toBe("伺服器暫時沒有回應，請再試一次")
    respond(504, "")
    expect(await failure()).toBe("伺服器暫時沒有回應，請再試一次")
  })

  it("其他沒有說明的錯誤照舊帶狀態碼", async () => {
    respond(500, "Internal Server Error", "text/plain")
    expect(await failure()).toBe("伺服器回應 500")
  })
})
