import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { QueuedRecording } from "@/lib/offline-queue"
import type { RecordingLanguage } from "@/api/visits"

const { uploadAudio } = vi.hoisted(() => ({ uploadAudio: vi.fn() }))
vi.mock("@/api/visits", () => ({ uploadAudio }))

/** 模擬 IndexedDB 的交易完成事件，保存／重讀整筆錄音。 */
function recordingDb() {
  const items = new Map<string, QueuedRecording>()
  const db = {
    close() {},
    transaction() {
      const transaction = {
        oncomplete: null as (() => void) | null,
        objectStore: () => ({
          put(item: QueuedRecording) {
            items.set(item.clientRef, structuredClone(item))
            return { result: item.clientRef }
          },
          delete(ref: string) {
            items.delete(ref)
            return { result: undefined }
          },
          getAll() {
            return { result: structuredClone([...items.values()]) }
          },
        }),
      }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    },
  }
  return {
    open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
}

function recording(language?: RecordingLanguage): QueuedRecording {
  return {
    clientRef: "offline-1",
    customerId: "C001",
    customerName: "康泰藥局",
    filename: "visit.m4a",
    language,
    blob: new Blob(["recording"], { type: "audio/mp4" }),
    recordedAt: 1,
    durationSeconds: 20,
    state: "pending",
    visitId: null,
    error: null,
  }
}

beforeEach(() => {
  vi.resetModules()
  uploadAudio.mockReset().mockResolvedValue({ id: "V1" })
  vi.stubGlobal("navigator", { onLine: false })
  vi.stubGlobal("indexedDB", recordingDb())
})
afterEach(() => vi.unstubAllGlobals())

describe("離線錄音的語言", () => {
  it.each(["auto", "nan-TW", "en", "ja", "id", "vi", "th"] as const)(
    "%s 跟錄音存進手機，恢復連線後沿用同一語言",
    async (language) => {
      const { uploadQueue } = await import("@/lib/offline-queue")
      expect(await uploadQueue.save(recording(language))).toBe(true)
      await uploadQueue.flush()
      expect(uploadAudio).not.toHaveBeenCalled()
      expect(uploadQueue.getSnapshot().items[0].language).toBe(language)
      vi.stubGlobal("navigator", { onLine: true })
      await uploadQueue.flush()
      expect(uploadAudio).toHaveBeenCalledWith(
        "C001",
        expect.any(Blob),
        "visit.m4a",
        "offline-1",
        language
      )
      expect(uploadQueue.getSnapshot().items[0]).toMatchObject({
        state: "sent",
        language,
        blob: null,
        visitId: "V1",
      })
    }
  )

  it("上傳失敗後重送沿用同一個語言與錄音編號", async () => {
    const { uploadQueue } = await import("@/lib/offline-queue")
    const item = recording("auto")
    await uploadQueue.save(item)
    uploadAudio.mockRejectedValueOnce(new TypeError("offline"))
    await expect(uploadQueue.sendNow(item)).rejects.toThrow("offline")
    vi.stubGlobal("navigator", { onLine: true })
    await uploadQueue.flush()
    expect(uploadAudio).toHaveBeenCalledTimes(2)
    expect(
      uploadAudio.mock.calls.every(
        (call) => call[3] === "offline-1" && call[4] === "auto"
      )
    ).toBe(true)
  })

  it("舊版錄音沒有語言欄位仍能正常重送", async () => {
    const { uploadQueue } = await import("@/lib/offline-queue")
    await uploadQueue.save(recording())
    vi.stubGlobal("navigator", { onLine: true })
    await uploadQueue.flush()
    expect(uploadAudio).toHaveBeenCalledWith(
      "C001",
      expect.any(Blob),
      "visit.m4a",
      "offline-1",
      undefined
    )
  })
})
