import { describe, expect, it } from "vitest"
import type { PriorityStrategy } from "@/api/customer-priority"
import {
  metricPercent,
  metricValue,
  strategyFingerprint,
  strategyChanges,
  validStrategy,
} from "@/lib/customer-priority"

const strategy: PriorityStrategy = {
  id: "demo",
  name: "營收",
  days: 90,
  daily_limit: 5,
  metrics: [
    { metric: "revenue", weight: 30, direction: "higher" },
    { metric: "growth", weight: 10, direction: "higher" },
  ],
  priority_customers: [],
}

describe("客戶優先策略", () => {
  it("相對權重轉百分比，全部關閉時也不會除以零", () => {
    expect(metricPercent(strategy.metrics, "revenue")).toBe(75)
    expect(metricPercent(strategy.metrics, "growth")).toBe(25)
    expect(metricPercent([], "revenue")).toBe(0)
  })
  it("上期無資料不假造零成長，負成長保留正負號", () => {
    expect(metricValue("growth", null)).toBe("無資料")
    expect(metricValue("growth", -25)).toBe("-25.0%")
    expect(metricValue("growth", 10)).toBe("+10.0%")
  })
  it("調整目標、期間或指定客戶後，舊預覽不再視為有效", () => {
    expect(strategyFingerprint("M1", strategy)).not.toBe(
      strategyFingerprint("M2", strategy)
    )
    expect(strategyFingerprint("M1", strategy)).not.toBe(
      strategyFingerprint("M1", { ...strategy, days: 30 })
    )
    expect(strategyFingerprint("M1", strategy)).not.toBe(
      strategyFingerprint("M1", {
        ...strategy,
        metrics: [{ metric: "revenue", weight: 30, direction: "lower" }],
      })
    )
  })
  it("無權重、超出期間與空指定原因不能儲存", () => {
    expect(validStrategy(strategy)).toBe(true)
    expect(validStrategy({ ...strategy, metrics: [] })).toBe(false)
    expect(validStrategy({ ...strategy, days: 0 })).toBe(false)
    expect(
      validStrategy({
        ...strategy,
        priority_customers: [{ customer_id: "C1", reason: " ", until: null }],
      })
    ).toBe(false)
  })
  it("建議對照顯示優先方向與開關，而不是只比較原始權重", () => {
    const changes = strategyChanges(strategy, {
      ...strategy,
      metrics: [{ metric: "growth", weight: 100, direction: "lower" }],
    })
    expect(changes).toContainEqual({
      label: "營收貢獻",
      before: "75.0% · 高值優先",
      after: "不採計",
    })
    expect(changes).toContainEqual({
      label: "營收成長",
      before: "25.0% · 高值優先",
      after: "100.0% · 低值優先",
    })
    expect(
      strategyChanges(strategy, {
        ...strategy,
        metrics: strategy.metrics.map((r) => ({ ...r, weight: r.weight * 2 })),
      })
    ).toEqual([])
  })
  it("建議的期間與每日站數也要在帶入前看得到", () => {
    const changes = strategyChanges(strategy, {
      ...strategy,
      days: 30,
      daily_limit: 3,
    })
    expect(changes).toContainEqual({
      label: "統計期間",
      before: "90 天",
      after: "30 天",
    })
    expect(changes).toContainEqual({
      label: "每天建議站數",
      before: "5 站",
      after: "3 站",
    })
  })
})
