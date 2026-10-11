import { beforeEach, expect, it, vi } from "vitest"

import { request } from "@/api/client"
import { startTranscriptionSession } from "@/api/transcription"

vi.mock("@/api/client", () => ({
  request: vi.fn().mockResolvedValue({ token: "test-token" }),
  jsonBody: (method: string, body: unknown) => ({
    method,
    body: JSON.stringify(body),
  }),
}))
beforeEach(() => vi.clearAllMocks())

it.each(["en", "ja", "id", "vi", "th"] as const)(
  "%s 即時字幕使用錄音頁選擇的語言",
  async (language) => {
    await startTranscriptionSession("C001", language)
    const [path, init] = vi.mocked(request).mock.calls[0]
    expect(path).toBe("/api/transcription/session")
    expect(JSON.parse(init?.body as string)).toEqual({
      customer_id: "C001",
      language,
    })
  }
)

it("沒有指定語言的行程輸入沿用華語", async () => {
  await startTranscriptionSession(null)
  const init = vi.mocked(request).mock.calls[0][1]
  expect(JSON.parse(init?.body as string)).toEqual({
    customer_id: null,
    language: "zh-TW",
  })
})
