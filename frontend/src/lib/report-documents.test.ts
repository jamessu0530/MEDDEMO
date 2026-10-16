import { describe, expect, it } from "vitest"
import {
  applyReportBookmark,
  captureReportBookmark,
  editReportDraft,
  readReportLocalDraft,
  redoReportDraft,
  reportDraftKey,
  undoReportDraft,
  writeReportLocalDraft,
  type ReportDraftHistory,
  type ReportDraftStorage,
  type ReportLocalDraft,
} from "@/lib/report-documents"
import {
  normalizeReportConfig,
  type ReportConfig,
  type ReportQuery,
} from "@/lib/reports"

function config(name = "報表"): ReportConfig {
  return normalizeReportConfig({
    name,
    template: "manager",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    pages: [{ id: "overview", name: "總覽", desktop_layout: "free" }],
    cards: [
      {
        id: "sales",
        title: "銷售",
        metric: "sales",
        visual: "bar",
        dimension: "owner",
        limit: 5,
        desktop_layout: { x: 3, y: 5, w: 10, h: 16 },
        mobile_layout: { order: 0, width: "full", height: 12, hidden: false },
        format: { numbers: { sales: { decimals: 3 } } },
      },
    ],
  })
}
function memory(): ReportDraftStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}
const now = Date.parse("2026-10-15T08:00:00Z")
function draft(): ReportLocalDraft {
  return {
    version: 1,
    account_id: "M1",
    report_id: "report-default",
    revision: 3,
    saved_key: JSON.stringify(config("帳號版本")),
    config: config("本機草稿"),
    page_id: "overview",
    updated_at: new Date(now).toISOString(),
  }
}

describe("報表編輯保護", () => {
  it("清空圖表後可復原、重做並從本機草稿恢復空白畫布", () => {
    const original = config()
    const cleared = editReportDraft(
      { config: original, history: [], future: [] },
      { ...original, cards: [] }
    )
    expect(cleared.config.cards).toEqual([])
    expect(undoReportDraft(cleared).config).toEqual(original)
    expect(redoReportDraft(undoReportDraft(cleared)).config).toEqual(
      cleared.config
    )
    const storage = memory()
    writeReportLocalDraft(storage, { ...draft(), config: cleared.config })
    expect(
      readReportLocalDraft(storage, "M1", "report-default", now)?.config
    ).toEqual(cleared.config)
    expect(cleared.config.pages).toEqual(original.pages)
  })
  it("復原與重做保留順序，新編輯清除重做，沒有變化不新增紀錄", () => {
    const initial: ReportDraftHistory = {
      config: config("A"),
      history: [],
      future: [],
    }
    const second = editReportDraft(initial, config("B"))
    const third = editReportDraft(second, config("C"))
    const undone = undoReportDraft(undoReportDraft(third))
    expect(undone.config.name).toBe("A")
    expect(redoReportDraft(undone).config.name).toBe("B")
    expect(redoReportDraft(redoReportDraft(undone)).config.name).toBe("C")
    expect(editReportDraft(second, second.config)).toBe(second)
    expect(editReportDraft(undone, config("D")).future).toEqual([])
    expect(undoReportDraft(initial)).toBe(initial)
    expect(redoReportDraft(initial)).toBe(initial)
    expect(initial.config.name).toBe("A")
  })
  it("歷史上限 30 次且一個完整版面改動只有一筆歷史", () => {
    let current: ReportDraftHistory = {
      config: config(),
      history: [],
      future: [],
    }
    for (let i = 0; i < 35; i++)
      current = editReportDraft(current, config(String(i)))
    expect(current.history).toHaveLength(30)
    const before = current
    current = editReportDraft(current, {
      ...current.config,
      cards: current.config.cards.map((card) => ({
        ...card,
        desktop_layout: { x: 10, y: 20, w: 14, h: 30 },
      })),
    })
    expect(undoReportDraft(current).config).toBe(before.config)
    expect(
      redoReportDraft(undoReportDraft(current)).config.cards[0].desktop_layout
    ).toEqual({ x: 10, y: 20, w: 14, h: 30 })
  })
  it("書籤只保存期間、三層固定篩選與目前分頁，暫時探索不包含", () => {
    const original = config() as ReportQuery
    original.period = "custom"
    original.date_range = { start: "2031-03-01", end: "2031-04-17" }
    original.slicers = [{ dimension: "customer", keys: ["C1", "C2"] }]
    original.pages![0].filters = [{ dimension: "owner", key: "S1" }]
    original.cards[0].slicers = [{ dimension: "product", keys: ["P1"] }]
    original.selection_groups = [
      {
        source_id: "sales",
        points: [{ filters: [{ dimension: "owner", key: "S2" }], label: "S2" }],
      },
    ]
    original.drill_filters = { sales: [{ dimension: "year", key: "2031" }] }
    const captured = captureReportBookmark(original, "overview")
    expect(captured.date_range).toEqual(original.date_range)
    expect(captured.pages[0].filters).toEqual(original.pages![0].filters)
    expect(captured.cards[0].slicers).toEqual(original.cards[0].slicers)
    expect(JSON.stringify(captured)).not.toMatch(
      /selection_groups|drill_filters|desktop_layout|format|visual/
    )
  })
  it("套用書籤不還原圖表格式或版面，保留新增圖表，過期業務條件清除", () => {
    const source = config()
    source.owner_id = "S3"
    source.slicers = [{ dimension: "owner", keys: ["S1", "S3"] }]
    source.cards[0].filters = [{ dimension: "customer", key: "C1" }]
    const state = captureReportBookmark(source, "overview")
    const edited = config("新的名稱")
    edited.cards[0].format = { numbers: { sales: { decimals: 1 } } }
    edited.cards[0].desktop_layout = { x: 1, y: 1, w: 20, h: 20 }
    edited.cards.push({
      ...edited.cards[0],
      id: "new-card",
      filters: [{ dimension: "owner", key: "S2" }],
    })
    const applied = applyReportBookmark(edited, state, ["S1", "S2"])
    expect(applied.name).toBe("新的名稱")
    expect(applied.cards[0].format).toBe(edited.cards[0].format)
    expect(applied.cards[0].desktop_layout).toBe(edited.cards[0].desktop_layout)
    expect(applied.cards[0].filters).toEqual([
      { dimension: "customer", key: "C1" },
    ])
    expect(applied.cards[1].filters).toEqual(edited.cards[1].filters)
    expect(applied.owner_id).toBeNull()
    expect(applied.slicers).toEqual([{ dimension: "owner", keys: ["S1"] }])
  })
  it("草稿依實際帳號及報表隔離，儲存設定不混入查詢結果", () => {
    const storage = memory()
    writeReportLocalDraft(storage, draft())
    expect(readReportLocalDraft(storage, "M1", "report-default", now)).toEqual(
      draft()
    )
    expect(
      readReportLocalDraft(storage, "S1", "report-default", now)
    ).toBeNull()
    expect(readReportLocalDraft(storage, "M1", "report-other", now)).toBeNull()
    expect(reportDraftKey("A/B", "a:b")).not.toBe(reportDraftKey("A", "B/a:b"))
    expect(storage.getItem(reportDraftKey("M1", "report-default"))).not.toMatch(
      /row_count|totals|query_result/
    )
  })
  it("草稿拒絕損壞、過期、錯帳號、未來時間、非法版本及過大內容", () => {
    const storage = memory(),
      key = reportDraftKey("M1", "report-default")
    for (const patch of [
      { account_id: "S1" },
      { report_id: "other" },
      { version: 2 },
      { revision: -1 },
      { updated_at: "bad" },
      { updated_at: new Date(now + 120000).toISOString() },
      { updated_at: new Date(now - 15 * 86400000).toISOString() },
      { config: { cards: null } },
    ]) {
      storage.setItem(key, JSON.stringify({ ...draft(), ...patch }))
      expect(
        readReportLocalDraft(storage, "M1", "report-default", now)
      ).toBeNull()
    }
    storage.setItem(key, "{")
    expect(
      readReportLocalDraft(storage, "M1", "report-default", now)
    ).toBeNull()
    storage.setItem(key, "x".repeat(600001))
    expect(
      readReportLocalDraft(storage, "M1", "report-default", now)
    ).toBeNull()
  })
  it("儲存空間錯誤可回報，不把寫入失敗當作已保留", () => {
    const storage: ReportDraftStorage = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => undefined,
    }
    expect(
      readReportLocalDraft(storage, "M1", "report-default", now)
    ).toBeNull()
    expect(() => writeReportLocalDraft(storage, draft())).toThrow("quota")
  })
})
