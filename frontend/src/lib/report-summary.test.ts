import { describe, expect, it } from "vitest"
import { normalizeReportConfig, type ReportCard } from "@/lib/reports"
import { reportSummaryPair } from "@/lib/report-summary"

function cards(patches: Partial<ReportCard>[] = []) {
  return normalizeReportConfig({
    name: "業績",
    template: "manager",
    period: "this_month",
    owner_id: null,
    customer_type: null,
    cards: [
      {
        id: "total",
        title: "銷售",
        metric: "sales",
        visual: "kpi",
        dimension: "none",
        limit: 5,
        ...patches[0],
      },
      {
        id: "trend",
        title: "每月銷售",
        metric: "sales",
        visual: "line",
        dimension: "month",
        limit: 5,
        ...patches[1],
      },
    ],
  }).cards
}

describe("phone sales summary", () => {
  it("groups matching sales cards without modifying the document", () => {
    const original = cards()
    const before = structuredClone(original)
    expect(reportSummaryPair(original)).toEqual({
      totalId: "total",
      trendId: "trend",
    })
    expect(original).toEqual(before)
  })

  it("keeps independently filtered or drilled charts separate", () => {
    expect(
      reportSummaryPair(
        cards([{}, { filters: [{ dimension: "owner", key: "S1" }] }])
      )
    ).toBeNull()
    expect(
      reportSummaryPair(
        cards([{}, { date_range: { start: "2026-09-01", end: "2026-09-30" } }])
      )
    ).toBeNull()
    expect(
      reportSummaryPair(cards([{}, { legend: "customer_type" }]))
    ).toBeNull()
  })

  it("respects hidden cards and saved phone layouts", () => {
    expect(reportSummaryPair(cards([{ hidden: true }]))).toBeNull()
    expect(reportSummaryPair(cards([{}, { hidden: true }]))).toBeNull()
    expect(
      reportSummaryPair(
        cards([
          {
            mobile_layout: {
              order: 0,
              width: "half",
              height: 12,
              hidden: false,
            },
          },
        ])
      )
    ).toBeNull()
  })
})
