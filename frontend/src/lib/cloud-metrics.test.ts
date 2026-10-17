import { describe, expect, it } from "vitest"

import { metricNumber, metricTrend } from "./cloud-metrics"

describe("Cloud 指標呈現", () => {
  it("缺值與非有限值保留空白，與真實的零區分", () => {
    expect(metricNumber(null)).toBe("—")
    expect(metricNumber(undefined)).toBe("—")
    expect(metricNumber(Number.NaN)).toBe("—")
    expect(metricNumber(Infinity)).toBe("—")
    expect(metricNumber(0, 2)).toBe("0.00")
  })

  it("延遲轉毫秒、記憶體轉 MiB", () => {
    expect(metricNumber(0.1234, 0, 1000)).toBe("123")
    expect(metricNumber(104857600, 1, 1 / 1024 ** 2)).toBe("100.0")
  })

  it("收集斷點不跨接，時間間隔依真實 timestamp 繪製", () => {
    const path = metricTrend([
      { timestamp: 0, value: 1 },
      { timestamp: 60, value: 2 },
      { timestamp: 120, value: null },
      { timestamp: 180, value: 3 },
      { timestamp: 360, value: 2 },
    ])!
    expect(path.match(/M/g)).toHaveLength(3)
    expect(path).not.toContain("NaN")
  })

  it("空趨勢不畫折線，單點或零仍可呈現", () => {
    expect(metricTrend([])).toBeNull()
    expect(metricTrend([{ timestamp: 0, value: null }])).toBeNull()
    expect(metricTrend([{ timestamp: 0, value: 0 }])).toContain("M4.00,52.00")
  })
})

// 這些判斷直接影響展示時是否把延遲或缺漏誤當成正常。
import type { CloudMetrics, RouteMetric } from "@/api/cloud-metrics"
import {
  grafanaDashboardLink,
  metricHealth,
  metricUptime,
  nextMetricRefresh,
  rankedRoutes,
} from "./cloud-metrics"

function cloud(overrides: Partial<CloudMetrics> = {}): CloudMetrics {
  return {
    status: "ready",
    message: null,
    environment: "production",
    dashboard_url: "https://example.grafana.net/d/meddemo-api?orgId=1",
    window: "1h",
    window_seconds: 3600,
    step_seconds: 15,
    refresh_seconds: 5,
    rate_window_seconds: 60,
    range_start: 0,
    range_end: 3600,
    fetched_at: "2026-10-17T04:00:00Z",
    last_scraped_at: "2026-10-17T03:59:55Z",
    scrape_up: 1,
    instances_up: 1,
    instances_total: 1,
    requests_per_second: 2,
    requests_in_range: 100,
    success_percent: 100,
    error_percent: 0,
    client_error_percent: 0,
    p50_seconds: 0.05,
    p95_seconds: 0.2,
    p99_seconds: 0.4,
    average_seconds: 0.1,
    cpu_cores: 0.1,
    memory_bytes: 1000,
    in_progress: 1,
    history: {},
    routes: [],
    status_codes: [],
    instances: [],
    ...overrides,
  }
}

it("同步時鐘對齊五秒邊界，不從上次請求完成後另等五秒", () => {
  expect(nextMetricRefresh(1_001_000, 5)).toBe(4100)
  expect(nextMetricRefresh(1_004_900, 5)).toBe(200)
})

it("開 Grafana 時帶入相同時間範圍、環境與刷新節奏", () => {
  const url = new URL(
    grafanaDashboardLink(
      cloud({ window: "6h", environment: "local-validation" })
    )
  )
  expect(url.searchParams.get("from")).toBe("now-6h")
  expect(url.searchParams.get("var-environment")).toBe("local-validation")
  expect(url.searchParams.get("refresh")).toBe("5s")
  expect(url.searchParams.get("orgId")).toBe("1")
})

it("用來源樣本時間判斷延遲，不能以新的查詢時間冒充同步", () => {
  const now = Date.parse("2026-10-17T04:00:00Z")
  expect(metricHealth(cloud(), now, null).tone).toBe("good")
  expect(
    metricHealth(cloud({ last_scraped_at: "2026-10-17T03:59:30Z" }), now, null)
      .label
  ).toBe("樣本延遲")
  expect(metricHealth(cloud({ scrape_up: 0 }), now, null).tone).toBe("danger")
  expect(metricHealth(cloud(), now, "連線失敗").label).toBe("更新中斷")
})

it("錯誤率與長尾延遲有明確觀測門檻，未連接時不顯示正常", () => {
  const now = Date.parse("2026-10-17T04:00:00Z")
  expect(metricHealth(cloud({ error_percent: 1 }), now, null).label).toBe(
    "錯誤率升高"
  )
  expect(metricHealth(cloud({ p95_seconds: 1 }), now, null).label).toBe(
    "回應時間偏高"
  )
  expect(metricHealth(cloud({ status: "unconfigured" }), now, null).label).toBe(
    "等待連接"
  )
})

it("API 排行能找出慢速與錯誤端點，缺值不排在有效樣本之前", () => {
  const routes: RouteMetric[] = [
    {
      method: "GET",
      route: "/busy",
      requests: 100,
      requests_per_second: 2,
      p95_seconds: 0.1,
      server_errors: 0,
      client_errors: 0,
    },
    {
      method: "POST",
      route: "/slow",
      requests: 10,
      requests_per_second: 0.1,
      p95_seconds: 2,
      server_errors: 2,
      client_errors: 0,
    },
    {
      method: "GET",
      route: "/missing",
      requests: null,
      requests_per_second: null,
      p95_seconds: null,
      server_errors: null,
      client_errors: null,
    },
  ]
  expect(rankedRoutes(routes, "p95_seconds")[0].route).toBe("/slow")
  expect(rankedRoutes(routes, "server_errors")[0].route).toBe("/slow")
  expect(rankedRoutes(routes, "requests")[0].route).toBe("/busy")
  expect(routes[0].route).toBe("/busy")
})

it("秒級趨勢不把短時間內的正常樣本誤判成斷線", () => {
  const points = [
    { timestamp: 0, value: 1 },
    { timestamp: 5, value: 2 },
    { timestamp: 20, value: 1 },
  ]
  const path = metricTrend(points, {
    start: 0,
    end: 30,
    ceiling: 3,
    width: 584,
    height: 160,
    stepSeconds: 5,
  })!
  expect(path.match(/M/g)).toHaveLength(2)
  expect(metricUptime(90061)).toBe("1 天 1 小時")
  expect(metricUptime(null)).toBe("—")
})
