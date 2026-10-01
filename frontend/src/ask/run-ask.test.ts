import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Ask } from "@/api/asks"

const api = vi.hoisted(() => ({ createAsk: vi.fn(), getAsk: vi.fn() }))
vi.mock("@/api/asks", () => ({
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  isFinished: (ask: Ask) => ask.status !== "queued" && ask.status !== "running",
}))

import { ApiError } from "@/api/client"
import { createConversation } from "@/ask/conversation"
import { runAsk } from "@/ask/run-ask"

const ask = (status: Ask["status"]) => ({ id: "a1", status, trace: [] }) as unknown as Ask

function start() {
  const conversation = createConversation()
  const entryId = conversation.addToolRun("data", "北區為什麼掉？")
  const result = runAsk(conversation, entryId, "data", "北區為什麼掉？", new AbortController().signal)
  // 先接住，測試裡才不會出現「沒有人處理的 rejection」
  result.catch(() => {})
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  api.createAsk.mockReset().mockResolvedValue(ask("queued"))
  api.getAsk.mockReset()
})

afterEach(() => vi.useRealTimers())

describe("runAsk", () => {
  it("網路一時不通、後端暫時出錯就等下一輪", async () => {
    api.getAsk
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new ApiError("伺服器回應 502", 502))
      .mockResolvedValue(ask("answered"))
    const result = start()
    await vi.advanceTimersByTimeAsync(1600)
    expect((await result).status).toBe("answered")
    expect(api.getAsk).toHaveBeenCalledTimes(3)
  })

  it("後端明確說不行（提問不存在、登入失效）就停，不會每半秒一直問下去", async () => {
    // 輪詢不再跟著頁面卸載而停，這種再問幾次答案都一樣的情況要自己停
    api.getAsk.mockRejectedValue(new ApiError("找不到這個提問", 404))
    const result = start()
    await vi.advanceTimersByTimeAsync(5000)
    await expect(result).rejects.toThrow("找不到這個提問")
    expect(api.getAsk).toHaveBeenCalledTimes(1)
  })

  it("附了檔案就交給 createAsk，後端回的附件掛到那一句提問上", async () => {
    const attachment = { id: 3, kind: "image", filename: "box.jpg", url: "/api/attachments/3?sig=x", thumb_url: null }
    api.createAsk.mockResolvedValue({ ...ask("answered"), attachment })
    const conversation = createConversation()
    const utteranceId = conversation.addUtterance("user", "typed", "這個賣多少")
    const entryId = conversation.addToolRun("data", "這個賣多少")
    const file = new File(["x"], "box.jpg", { type: "image/jpeg" })
    await runAsk(conversation, entryId, "data", "這個賣多少", new AbortController().signal, { file, utteranceId })
    expect(api.createAsk).toHaveBeenCalledWith("data", "這個賣多少", file)
    const first = conversation.getSnapshot()[0]
    expect(first.kind === "user" && first.attachment).toEqual(attachment)
  })
})
