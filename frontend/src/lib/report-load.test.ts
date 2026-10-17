import { describe, expect, it, vi } from "vitest"
import { loadReportProgressively, visibleReportCardIds } from "./report-load"
import { reportDataKey, type ReportData, type ReportQuery } from "./reports"

const query: ReportQuery = {
  name: "載入測試",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  pages: [
    { id: "overview", name: "總覽" },
    { id: "other", name: "其他" },
  ],
  cards: [
    {
      id: "trend",
      title: "趨勢",
      metric: "sales",
      dimension: "month",
      visual: "line",
      limit: 6,
    },
    {
      id: "total",
      title: "業績",
      metric: "sales",
      dimension: "none",
      visual: "kpi",
      limit: 5,
    },
    {
      id: "customers",
      title: "客戶",
      metric: "sales",
      dimension: "customer",
      visual: "bar",
      limit: 5,
    },
    {
      id: "other",
      page_id: "other",
      title: "其他",
      metric: "sales",
      dimension: "customer",
      visual: "bar",
      limit: 5,
    },
    {
      id: "hidden",
      hidden: true,
      title: "隱藏",
      metric: "sales",
      dimension: "customer",
      visual: "bar",
      limit: 5,
    },
  ],
  selection_groups: [
    {
      source_id: "other",
      points: [
        { label: "C1", filters: [{ dimension: "customer", key: "C1" }] },
      ],
    },
  ],
}
function response(ids: string[]): ReportData {
  return {
    as_of: "2031-04-17",
    start: "2031-04-01",
    end: "2031-04-17",
    scope_label: "全公司共用",
    cards: ids.map((id) => ({ id, total: 10, points: [], note: null })),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe("報表分批載入", () => {
  it("只請求當頁可見圖表，編輯時包含隱藏圖表", () => {
    expect(visibleReportCardIds(query, "overview", {}, false)).toEqual([
      "trend",
      "total",
      "customers",
    ])
    expect(
      visibleReportCardIds(
        query,
        "overview",
        { hidden: false, trend: true },
        false
      )
    ).toEqual(["total", "customers", "hidden"])
    expect(visibleReportCardIds(query, "overview", {}, true)).toEqual([
      "trend",
      "total",
      "customers",
      "hidden",
    ])
    expect(visibleReportCardIds(query, "other", {}, false)).toEqual(["other"])
    expect(
      reportDataKey({ ...query, requested_card_ids: ["trend", "total"] })
    ).not.toBe(reportDataKey({ ...query, requested_card_ids: ["other"] }))
  })

  it("先請求 KPI、限制兩個併行，慢圖表不阻擋已完成指標，跨頁來源條件仍保留", async () => {
    const calls: {
      query: ReportQuery
      signal: AbortSignal
      result: ReturnType<typeof deferred<ReportData>>
    }[] = []
    const fetch = vi.fn((query: ReportQuery, signal: AbortSignal) => {
      const result = deferred<ReportData>()
      calls.push({ query, signal, result })
      return result.promise
    })
    const progress = vi.fn()
    const loaded = loadReportProgressively(
      { ...query, requested_card_ids: ["trend", "total", "customers"] },
      fetch,
      new AbortController().signal,
      progress
    )
    expect(calls.map((call) => call.query.requested_card_ids)).toEqual([
      ["total"],
      ["trend"],
    ])
    expect(calls[0].query.cards).toBe(query.cards)
    expect(calls[0].query.selection_groups).toBe(query.selection_groups)
    calls[0].result.resolve(response(["total"]))
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(progress).toHaveBeenLastCalledWith(response(["total"]), false)
    calls[2].result.resolve(response(["customers"]))
    await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(2))
    calls[1].result.resolve(response(["trend"]))
    expect((await loaded).cards.map((card) => card.id)).toEqual([
      "trend",
      "total",
      "customers",
    ])
    expect(progress.mock.calls.at(-1)?.[1]).toBe(true)
  })

  it("切換條件後中止舊請求，即使舊請求晚到也不發布資料", async () => {
    const controller = new AbortController(),
      late = deferred<ReportData>(),
      progress = vi.fn()
    const loaded = loadReportProgressively(
      { ...query, requested_card_ids: ["total"] },
      () => late.promise,
      controller.signal,
      progress
    )
    const rejected = expect(loaded).rejects.toMatchObject({
      name: "AbortError",
    })
    controller.abort()
    late.resolve(response(["total"]))
    await rejected
    expect(progress).not.toHaveBeenCalled()
  })

  it("空頁面只取得日期與權限範圍，不查其他頁圖表", async () => {
    const fetch = vi.fn(async (query: ReportQuery) =>
      response(query.requested_card_ids!)
    )
    const data = await loadReportProgressively(
      { ...query, requested_card_ids: [] },
      fetch,
      new AbortController().signal,
      vi.fn()
    )
    expect(data.cards).toEqual([])
    expect(fetch.mock.calls[0][0].requested_card_ids).toEqual([])
  })

  it("拒絕混合不同資料基準日，並取消其餘請求", async () => {
    const signals: AbortSignal[] = []
    const fetch = vi.fn(async (query: ReportQuery, signal: AbortSignal) => {
      signals.push(signal)
      return {
        ...response(query.requested_card_ids!),
        as_of:
          query.requested_card_ids?.[0] === "total"
            ? "2031-04-17"
            : "2031-04-18",
      }
    })
    await expect(
      loadReportProgressively(
        { ...query, requested_card_ids: ["total", "trend"] },
        fetch,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow("資料基準已變更")
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it("圖表失敗時保留已發布資料，取消仍在等候的圖表", async () => {
    const late = deferred<ReportData>(),
      progress = vi.fn(),
      signals: AbortSignal[] = []
    const loaded = loadReportProgressively(
      { ...query, requested_card_ids: ["total", "trend", "customers"] },
      (query, signal) => {
        signals.push(signal)
        if (query.requested_card_ids?.[0] === "total")
          return Promise.resolve(response(["total"]))
        if (query.requested_card_ids?.[0] === "customers")
          return Promise.reject(new Error("伺服器錯誤"))
        return late.promise
      },
      new AbortController().signal,
      progress
    )
    await expect(loaded).rejects.toThrow("伺服器錯誤")
    expect(progress).toHaveBeenCalledTimes(1)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    late.resolve(response(["trend"]))
    await Promise.resolve()
    expect(progress).toHaveBeenCalledTimes(1)
  })
})
