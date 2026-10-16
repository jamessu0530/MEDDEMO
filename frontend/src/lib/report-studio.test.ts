import { describe, expect, it } from "vitest"
import {
  assignReportField,
  canvasQuerySelections,
  commitStudioLayout,
  createStudioObject,
  pruneStudioReferences,
  placeStudioObject,
  safeStudioExploration,
  readStudioField,
  studioLayoutConfig,
  updateCanvasSelection,
} from "@/lib/report-studio"
import { captureReportBookmark } from "@/lib/report-documents"
import {
  reportDataKey,
  type ReportCard,
  type ReportConfig,
} from "@/lib/reports"
const card: ReportCard = {
  id: "sales",
  title: "業績",
  metric: "sales",
  dimension: "customer",
  visual: "bar",
  limit: 5,
  page_id: "overview",
}
const config: ReportConfig = {
  name: "測試",
  template: "manager",
  period: "year",
  owner_id: null,
  customer_type: null,
  pages: [
    { id: "overview", name: "總覽" },
    { id: "detail", name: "分析", tooltip: true },
  ],
  cards: [card],
}
describe("report studio", () => {
  it("only accepts known fields and safely ignores external drag payloads", () => {
    expect(readStudioField('{"kind":"dimension","key":"customer"}')).toEqual({
      kind: "dimension",
      key: "customer",
    })
    for (const value of [
      "text",
      "{}",
      '{"kind":"metric","key":"sql"}',
      '{"kind":"dataset","dataset_id":"x","column":null}',
    ])
      expect(readStudioField(value)).toBeNull()
  })
  it("assigns metrics and group fields without mutating the original", () => {
    const updated = assignReportField(
      card,
      { kind: "metric", key: "net_margin" },
      "value"
    )
    expect(updated.metric).toBe("net_margin")
    expect(card.metric).toBe("sales")
    expect(
      assignReportField(
        { ...card, dimension: "none", visual: "kpi" },
        { kind: "dimension", key: "product" },
        "group"
      ).visual
    ).toBe("bar")
    expect(() =>
      assignReportField(card, { kind: "dimension", key: "customer" }, "value")
    ).toThrow("指標")
    expect(() =>
      assignReportField(
        { ...card, metric: "customers" },
        { kind: "dimension", key: "month" },
        "group"
      )
    ).toThrow("無法")
  })
  it("rejects duplicate matrix axes and incompatible legends", () => {
    expect(() =>
      assignReportField(card, { kind: "dimension", key: "customer" }, "legend")
    ).toThrow("不同")
    expect(() =>
      assignReportField(
        {
          ...card,
          visual: "matrix",
          matrix: { rows: ["customer"], columns: [], metrics: ["sales"] },
        },
        { kind: "dimension", key: "customer" },
        "column"
      )
    ).toThrow("重複")
  })
  it("uses browser-only layout proxies and writes object geometry back separately", () => {
    const object = createStudioObject("text", "overview")
    const original = { ...config, objects: [object] }
    const layout = studioLayoutConfig(original)
    expect(layout.cards).toHaveLength(2)
    const next = commitStudioLayout(original, {
      ...layout,
      cards: layout.cards.map((item) =>
        item.id === object.id
          ? { ...item, desktop_layout: { x: 4, y: 8, w: 8, h: 12 } }
          : item
      ),
    })
    expect(next.cards).toHaveLength(1)
    expect(next.objects?.[0].desktop_layout).toEqual({
      x: 4,
      y: 8,
      w: 8,
      h: 12,
    })
    expect(original.objects[0].desktop_layout.x).toBe(0)
  })
  it("syncs canvas slicers by group across pages while preserving unrelated values", () => {
    const a = createStudioObject("slicer", "overview"),
      b = createStudioObject("slicer", "detail"),
      c = createStudioObject("slicer", "detail")
    a.slicer!.sync_group = b.slicer!.sync_group = "customers"
    const report = { ...config, objects: [a, b, c] }
    const values = updateCanvasSelection(report, { [c.id]: ["C2"] }, a.id, [
      "C1",
    ])
    expect(values[b.id]).toEqual(["C1"])
    expect(values[c.id]).toEqual(["C2"])
    expect(canvasQuerySelections(report, values)).toHaveLength(3)
  })
  it("removes references to deleted pages, cards and toggle targets", () => {
    const button = createStudioObject("button", "removed")
    button.action = { kind: "toggle", target: "missing" }
    const result = pruneStudioReferences({
      ...config,
      cards: [
        { ...card, tooltip_page: "missing", drillthrough_page: "detail" },
      ],
      objects: [button],
    })
    expect(result.cards[0].tooltip_page).toBeNull()
    expect(result.cards[0].drillthrough_page).toBe("detail")
    expect(result.objects?.[0].page_id).toBe("overview")
    expect(result.objects?.[0].action?.kind).toBe("reset")
  })
  it("bookmark captures drill, selections, visibility and canvas state explicitly", () => {
    const exploration = {
      selections: [],
      drills: {},
      matrix_views: {},
      canvas_values: { slicer: ["C1"] },
      hidden: { sales: true },
      navigation_page: "detail",
      navigation_filters: [{ dimension: "customer" as const, key: "C1" }],
    }
    expect(
      captureReportBookmark(config, "detail", exploration).exploration
    ).toEqual(exploration)
    expect(captureReportBookmark(config, "detail").exploration).toBeUndefined()
  })
  it("query key changes for map coordinates, stage ordering and analytics but not design colors", () => {
    expect(
      reportDataKey({ ...config, cards: [{ ...card, visual: "map" }] })
    ).not.toBe(reportDataKey(config))
    expect(
      reportDataKey({
        ...config,
        cards: [
          { ...card, analytics: { trend_line: true, forecast_periods: 3 } },
        ],
      })
    ).not.toBe(reportDataKey(config))
    expect(
      reportDataKey({
        ...config,
        cards: [{ ...card, color: "#123456", hidden: true }],
      })
    ).toBe(reportDataKey(config))
  })
  it("places imported charts in an available area above other layers", () => {
    const object = createStudioObject("text", "overview")
    const placed = placeStudioObject(
      {
        ...config,
        cards: [
          { ...card, desktop_layout: { x: 0, y: 0, w: 24, h: 16 }, layer: 5 },
        ],
      },
      object
    )
    expect(placed.desktop_layout.y).toBeGreaterThanOrEqual(16)
    expect(placed.layer).toBe(6)
  })
  it("old bookmarks cannot restore foreign owners or deleted objects", () => {
    const slicer = createStudioObject("slicer", "overview")
    slicer.slicer!.dimension = "owner"
    const state = safeStudioExploration(
      { ...config, objects: [slicer] },
      {
        selections: [
          {
            source_id: "deleted",
            points: [
              {
                label: "other",
                filters: [{ dimension: "customer", key: "C3" }],
              },
            ],
          },
        ],
        drills: {},
        matrix_views: {},
        canvas_values: { [slicer.id]: ["S1", "S3"] },
        hidden: { missing: true, sales: true },
        navigation_page: "detail",
        navigation_filters: [{ dimension: "owner", key: "S3" }],
      },
      ["S1"]
    )
    expect(state.selections).toEqual([])
    expect(state.canvas_values[slicer.id]).toEqual(["S1"])
    expect(state.hidden).toEqual({ sales: true })
    expect(state.navigation_filters).toEqual([])
  })
})
