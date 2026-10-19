import { afterEach, describe, expect, it, vi } from "vitest"
import type { Product } from "@/api/products"
import { finishWork, scheduleWork, sortWork } from "@/lib/background-work"
import { pageWork, type PageWorkInput } from "@/lib/page-work"
import { catalogProducts } from "@/lib/product-search"
import { discoverProducts } from "@/lib/product-discovery"
import { reportMatrixFormatDomain } from "@/lib/report-format"
import { matrixHeaders, MATRIX_ROOT } from "@/lib/report-matrix"
import {
  reportMatrixOptions,
  type ReportCard,
  type ReportMatrixData,
} from "@/lib/reports"
import { revealed } from "@/lib/route-draw"

const products: Product[] = Array.from({ length: 1000 }, (_, i) => ({
  sku: `P${i}`,
  name: `商品 ${i}`,
  category: i % 2 ? "醫材" : "保健",
  spec: "Large",
  unit: "組",
  aliases: ["口語名稱"],
  common: false,
}))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("頁面背景運算", () => {
  it("遠端錯字搜尋保留相關度與類別篩選，空結果不退回本機匹配", () => {
    for (const matchedSkus of [["P19", "deleted", "P2", "P1"], []]) {
      const result = finishWork(pageWork({
        kind: "products", source: products,
        query: { query: "錯字", category: "醫材", matchedSkus, discovery: null },
      }))
      if (result.kind !== "products") throw new Error("wrong result")
      expect(result.value.indices.map((at) => products[at].sku)).toEqual(matchedSkus.length ? ["P19", "P1"] : [])
      expect(result.value.categories).toHaveLength(2)
    }
  })
  it("型錄多詞搜尋、分類和完整結果與原本相同，重用索引不會殘留舊搜尋", () => {
    for (const query of ["", "口語 large", "P19", "不存在"]) {
      const result = finishWork(
        pageWork({
          kind: "products",
          source: products,
          query: { query, category: "醫材", discovery: null },
        })
      )
      if (result.kind !== "products") throw new Error("wrong result")
      expect(result.value.indices.map((index) => products[index])).toEqual(
        catalogProducts(products, query, "醫材")
      )
      expect(result.value.categories).toEqual([
        { name: "保健", count: 500 },
        { name: "醫材", count: 500 },
      ])
    }
  })

  it("推薦排序保留既有偏好和固定種子的結果；不會混入篩選外商品", () => {
    const discovery = {
      seed: "test",
      profile: {},
      now: Date.parse("2026-10-17T01:00:00Z"),
      visibleSkus: ["P1"],
      previousSkus: [],
    }
    const result = finishWork(
      pageWork({
        kind: "products",
        source: products,
        query: { query: "", category: "醫材", discovery },
      })
    )
    if (result.kind !== "products") throw new Error("wrong result")
    expect(result.value.indices.map((index) => products[index])).toEqual(
      discoverProducts(
        catalogProducts(products, "", "醫材"),
        {},
        "test",
        ["P1"],
        discovery.now
      )
    )
    const single = products.slice(0, 2)
    const first = discoverProducts(single, {}, "fixed", [], discovery.now)
    const swap = finishWork(
      pageWork({
        kind: "products",
        source: single,
        query: {
          query: "",
          category: null,
          discovery: {
            ...discovery,
            seed: "fixed",
            previousSkus: first.map((p) => p.sku),
          },
        },
      })
    )
    if (swap.kind !== "products") throw new Error("wrong result")
    expect(swap.value.indices.map((index) => single[index].sku)).toEqual(
      first.map((p) => p.sku).reverse()
    )
  })

  it("編碼路線解成座標與動畫距離，已畫完的線段保留原陣列", () => {
    const result = finishWork(
      pageWork({
        kind: "route",
        source: {
          origin: null,
          stops: [],
          legs: [
            { done: true, polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", steps: [] },
          ],
        },
      })
    )
    if (result.kind !== "route") throw new Error("wrong result")
    const plan = result.value
    expect(plan.pieces[0].path).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
    expect(plan.total).toBeGreaterThan(0)
    expect(revealed(plan.pieces[0], plan.total)).toBe(plan.pieces[0].path)
    const halfway = revealed(plan.pieces[0], plan.pieces[0].at[1] / 2)
    expect(halfway[1].lat).toBeCloseTo(39.6)
  })

  it("矩陣一次建立索引及各指標範圍，排除小計與空值並保留伺服器全範圍", () => {
    const card: ReportCard = {
      id: "m",
      title: "矩陣",
      metric: "sales",
      dimension: "owner",
      visual: "matrix",
      limit: 25,
      matrix: {
        rows: ["owner"],
        columns: [],
        metrics: ["sales", "net_margin_rate"],
      },
    }
    const data: ReportMatrixData = {
      options: reportMatrixOptions(card),
      rows: [
        {
          id: "a",
          path: [],
          label: "A",
          depth: 1,
          has_children: false,
          expanded: false,
          show_values: true,
        },
        {
          id: "subtotal",
          path: [],
          label: "小計",
          depth: 1,
          has_children: true,
          expanded: false,
          show_values: true,
        },
      ],
      columns: [],
      cells: [
        {
          row_id: "a",
          column_id: "[]",
          row_count: 1,
          values: { sales: -20, net_margin_rate: null },
          comparisons: {},
        },
        {
          row_id: "subtotal",
          column_id: "[]",
          row_count: 10,
          values: { sales: 1000 },
          comparisons: {},
        },
      ],
      totals: { sales: 1000 },
      row_total: 2,
      column_total: 0,
      row_page: 1,
      column_page: 1,
      row_page_size: 25,
      column_page_size: 10,
      note: "test",
      format_domains: { net_margin_rate: { minimum: -1, maximum: 2 } },
    }
    const result = finishWork(
      pageWork({
        kind: "matrix",
        source: { data, highlight: data },
        query: { card, view: {} },
      })
    )
    if (result.kind !== "matrix") throw new Error("wrong result")
    expect(result.value.index.get("a|[]")).toBe(0)
    expect(result.value.selectedIndex.get("subtotal|[]")).toBe(1)
    for (const metric of ["sales", "net_margin_rate"] as const)
      expect(result.value.domains[metric]).toEqual(
        reportMatrixFormatDomain(data, metric)
      )
    expect(result.value.headers).toEqual(matrixHeaders(card, [MATRIX_ROOT], {}))
    expect(result.value.domains.net_margin_rate).toBe(
      data.format_domains!.net_margin_rate
    )
  })

  it("大量商品排序與單段長路線的降級計算都會讓出執行時間，可取消", async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => (now += 3))
    const timer = vi.spyOn(globalThis, "setTimeout")
    const inputs: PageWorkInput[] = [
      {
        kind: "products",
        source: products,
        query: {
          query: "",
          category: null,
          discovery: {
            seed: "large",
            profile: {},
            visibleSkus: [],
            previousSkus: [],
            now: 0,
          },
        },
      },
      {
        kind: "route",
        source: {
          origin: null,
          stops: [],
          legs: [
            { polyline: "??" + "AA".repeat(1000), steps: [], done: false },
          ],
        },
      },
    ]
    for (const input of inputs) {
      timer.mockClear()
      const pending = scheduleWork(pageWork(input), () => false)
      await vi.runAllTimersAsync()
      expect(await pending).toEqual(finishWork(pageWork(input)))
      expect(timer.mock.calls.length).toBeGreaterThan(5)
    }
    let cancelled = false
    const pending = scheduleWork(pageWork(inputs[0]), () => cancelled)
    cancelled = true
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()
  })

  it("分批排序保持相同值原始順序", () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      order: i,
      value: i % 5,
    }))
    expect(finishWork(sortWork(items, (a, b) => a.value - b.value))).toEqual(
      items.toSorted((a, b) => a.value - b.value)
    )
  })
})
