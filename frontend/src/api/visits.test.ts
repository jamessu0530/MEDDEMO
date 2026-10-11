import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/api/client"
import { uploadAudio, type RecordingLanguage } from "@/api/visits"

vi.mock("@/api/client", () => ({
  request: vi.fn().mockResolvedValue({ id: "V1" }),
  jsonBody: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

describe("拜訪錄音的上傳語言", () => {
  it.each([
    "auto",
    "zh-TW",
    "nan-TW",
    "en",
    "ja",
    "id",
    "vi",
    "th",
  ] satisfies RecordingLanguage[])(
    "%s 模式連同客戶與去重編號一起送出，舊錄音也相容",
    async (value) => {
      await uploadAudio(
        "C001",
        new Blob(["recording"], { type: "audio/mp4" }),
        "visit.m4a",
        "offline-1",
        value
      )
      const [path, init] = vi.mocked(request).mock.calls[0]
      const body = init?.body as FormData
      expect(path).toBe("/api/visits/audio")
      expect(body.get("language")).toBe(value)
      expect(body.get("customer_id")).toBe("C001")
      expect(body.get("client_ref")).toBe("offline-1")
      expect((body.get("file") as File).name).toBe("visit.m4a")
    }
  )

  it("沒有記語言的舊手機錄音沿用華語", async () => {
    await uploadAudio("C001", new Blob(["recording"]), "visit.webm", "old-1")
    expect(
      (vi.mocked(request).mock.calls[0][1]?.body as FormData).get("language")
    ).toBe("zh-TW")
  })
})
