import { beforeEach, expect, it, vi } from "vitest"
import type { LiveServerMessage, Session } from "@google/genai"

import { startTranscriptionSession } from "@/api/transcription"
import { startLiveTranscription } from "@/voice/live-transcription"

const mocks = vi.hoisted(() => ({
  connect:
    vi.fn<
      (params: {
        callbacks: { onmessage: (message: LiveServerMessage) => void }
      }) => Promise<Session>
    >(),
  stopCapture: vi.fn(),
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    live = { connect: mocks.connect }
  },
}))
vi.mock("@/api/transcription", () => ({
  startTranscriptionSession: vi.fn().mockResolvedValue({
    token: "test-token",
    model: "test-model",
    api_version: "v1alpha",
    config: {},
  }),
}))
vi.mock("@/voice/audio", () => ({
  INPUT_MIME_TYPE: "audio/pcm;rate=16000",
  startCapture: vi.fn().mockImplementation(async () => mocks.stopCapture),
  toBase64: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connect.mockResolvedValue({
    sendRealtimeInput: vi.fn(),
    close: vi.fn(),
  } as unknown as Session)
})

it.each([
  ["en", "Fish oil， 20 boxes, not 10."],
  ["ja", "薬局は 魚油を 20 箱注文したい。"],
  ["id", "Minyak ikan， dua puluh kotak."],
  ["vi", "Dầu cá， hai mươi hộp, không phải mười."],
  ["th", "น้ำมันปลา， 20 กล่อง ไม่ใช่ 10 กล่อง"],
] as const)("%s 字幕保留原語言的空白與標點", async (language, text) => {
  const onText = vi.fn()
  const live = await startLiveTranscription(
    {} as AudioContext,
    {} as MediaStream,
    "C001",
    onText,
    language
  )
  expect(startTranscriptionSession).toHaveBeenCalledWith("C001", language)
  const callbacks = mocks.connect.mock.calls[0][0].callbacks
  callbacks.onmessage({
    text: undefined,
    data: undefined,
    serverContent: { inputTranscription: { text } },
  })
  expect(onText).toHaveBeenLastCalledWith(text, "")
  callbacks.onmessage({
    text: undefined,
    data: undefined,
    serverContent: { interimInputTranscription: { text: " 30？ " } },
  })
  expect(onText).toHaveBeenLastCalledWith(text, " 30？ ")
  live?.stop()
  expect(mocks.stopCapture).toHaveBeenCalledOnce()
})

it.each(["auto", "nan-TW"] as const)(
  "%s 不開啟僅適用華語的即時字幕",
  async (language) => {
    expect(
      await startLiveTranscription(
        {} as AudioContext,
        {} as MediaStream,
        "C001",
        vi.fn(),
        language
      )
    ).toBeNull()
    expect(startTranscriptionSession).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
  }
)
