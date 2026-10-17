import { describe, expect, it, vi } from "vitest"
import { createReportSaveQueue } from "@/lib/report-autosave"
import { normalizeReportConfig } from "@/lib/reports"

const config = normalizeReportConfig({
  name: "個人報表",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  cards: [],
})

describe("報表自動儲存", () => {
  it("未修改不寫入；連續調整只寫入最後一份設定", async () => {
    const persist = vi.fn(async (config, revision) => ({
      config,
      revision: revision + 1,
    }))
    const queue = createReportSaveQueue(
      { config, revision: 1 },
      persist,
      () => {}
    )
    await queue.flush()
    expect(persist).not.toHaveBeenCalled()
    queue.update({ ...config, name: "第一版" })
    queue.update({ ...config, name: "最後版" })
    await queue.flush()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]).toEqual([{ ...config, name: "最後版" }, 1])
  })

  it("寫入期間繼續調整時依序補存，沿用新版本號且不平行覆蓋", async () => {
    let resolve!: (value: { config: typeof config; revision: number }) => void
    const first = { ...config, name: "第一版" }
    const latest = { ...config, name: "最新調整" }
    const persist = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockImplementationOnce(async (config, revision) => ({
        config,
        revision: revision + 1,
      }))
    const stored = vi.fn()
    const queue = createReportSaveQueue(
      { config, revision: 4 },
      persist,
      stored
    )
    queue.update(first)
    const pending = queue.flush()
    queue.update(latest)
    expect(queue.flush()).toBe(pending)
    expect(persist).toHaveBeenCalledTimes(1)
    resolve({ config: first, revision: 5 })
    await pending
    expect(persist.mock.calls[1]).toEqual([latest, 5])
    expect(stored.mock.calls[1][0].config).toEqual(latest)
    await queue.flush()
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it("斷線不標成已儲存，重試仍沿用正確版本並保存最新調整", async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("離線"))
      .mockImplementationOnce(async (config, revision) => ({
        config,
        revision: revision + 1,
      }))
    const stored = vi.fn()
    const queue = createReportSaveQueue(
      { config, revision: 2 },
      persist,
      stored
    )
    queue.update({ ...config, name: "離線調整" })
    await expect(queue.flush()).rejects.toThrow("離線")
    expect(stored).not.toHaveBeenCalled()
    const latest = { ...config, name: "重連前的最新調整" }
    queue.update(latest)
    await queue.flush()
    expect(persist.mock.calls[1]).toEqual([latest, 2])
  })
})
