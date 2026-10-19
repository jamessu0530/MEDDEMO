import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Ask } from "@/api/asks"
const api = vi.hoisted(() => ({
  createAsk: vi.fn(),
  getAsk: vi.fn(),
  capture: vi.fn(),
}))
vi.mock("@/api/asks", () => ({
  createAsk: api.createAsk,
  getAsk: api.getAsk,
  isFinished: (ask: Ask) => !["queued", "running"].includes(ask.status),
}))
vi.mock("@/lib/inquiry-location", () => ({
  captureInquiryLocation: api.capture,
}))
import { createConversation } from "@/ask/conversation"
import { pollAsk, runAsk } from "@/ask/run-ask"
const fix = {
  lat: 25.03,
  lng: 121.56,
  accuracy_m: 12,
  captured_at: "2026-10-20T08:00:00Z",
  place_name: null,
}
beforeEach(() => {
  vi.useFakeTimers()
  api.createAsk
    .mockReset()
    .mockResolvedValue({ id: "ask-1", status: "answered", trace: [] })
  api.getAsk
    .mockReset()
    .mockResolvedValue({ id: "ask-1", status: "answered", trace: [] })
  api.capture.mockReset().mockResolvedValue(fix)
})
afterEach(() => vi.useRealTimers())
describe("提問地點與該則查詢綁定", () => {
  it("打字、語音共用流程及附檔提問都只帶該次的一筆定位", async () => {
    for (const file of [undefined, new File(["box"], "box.txt")]) {
      const conversation = createConversation()
      const page = { path: "/customers/C01", title: "客戶檔案", facts: [] }
      const id = conversation.addToolRun("knowledge", "這家怎麼退貨？", {
        page,
      })
      await runAsk(
        conversation,
        id,
        "knowledge",
        "這家怎麼退貨？",
        new AbortController().signal,
        { file }
      )
      expect(api.createAsk).toHaveBeenLastCalledWith(
        "knowledge",
        "這家怎麼退貨？",
        file,
        false,
        { page, contextUsed: undefined, location: fix }
      )
    }
    expect(api.capture).toHaveBeenCalledTimes(2)
  })
  it("Ghost 不要求定位，也不送定位欄位", async () => {
    const conversation = createConversation()
    const id = conversation.addToolRun("data", "暫時查詢", { ghost: true })
    await runAsk(
      conversation,
      id,
      "data",
      "暫時查詢",
      new AbortController().signal
    )
    expect(api.capture).not.toHaveBeenCalled()
    expect(api.createAsk).toHaveBeenCalledWith(
      "data",
      "暫時查詢",
      undefined,
      true
    )
  })
  it("等待定位時取消，不會把問題或座標送給新登入帳號", async () => {
    let complete!: (value: typeof fix) => void
    api.capture.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    const conversation = createConversation()
    const id = conversation.addToolRun("data", "查詢")
    const controller = new AbortController()
    const pending = runAsk(conversation, id, "data", "查詢", controller.signal)
    controller.abort(new Error("已取消"))
    complete(fix)
    await expect(pending).rejects.toThrow("已取消")
    expect(api.createAsk).not.toHaveBeenCalled()
  })
  it("等待答案與重新打開原提問不會再次定位", async () => {
    api.createAsk.mockResolvedValue({
      id: "ask-1",
      status: "queued",
      trace: [],
    })
    const conversation = createConversation()
    const id = conversation.addToolRun("data", "查詢")
    const pending = runAsk(
      conversation,
      id,
      "data",
      "查詢",
      new AbortController().signal
    )
    await vi.advanceTimersByTimeAsync(500)
    const answer = await pending
    await pollAsk(conversation, id, answer, new AbortController().signal)
    expect(api.capture).toHaveBeenCalledTimes(1)
  })
})
