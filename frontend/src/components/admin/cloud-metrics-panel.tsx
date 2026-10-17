import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { ApiError } from "@/api/client"
import {
  getCloudMetrics,
  type CloudMetrics,
  type MetricsWindow,
} from "@/api/cloud-metrics"
import {
  Activity,
  Check,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import {
  METRICS_WINDOWS,
  grafanaDashboardLink,
  metricHealth,
  metricNumber,
  nextMetricRefresh,
} from "@/lib/cloud-metrics"
import { cn } from "@/lib/utils"
import {
  InstanceStatus,
  RouteRanking,
  StatusDistribution,
} from "./cloud-metrics-details"
import { MetricChart } from "./metric-chart"

const CLOCK = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
const TONE = {
  good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
}

export function CloudMetricsPanel() {
  const [data, setData] = useState<CloudMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [selectedWindow, setSelectedWindow] = useState<MetricsWindow>("1h")
  const [paused, setPaused] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const busy = useRef(false)
  const root = useRef<HTMLElement>(null)
  const presentationButton = useRef<HTMLButtonElement>(null)
  const exitButton = useRef<HTMLButtonElement>(null)
  const cadence = data?.refresh_seconds ?? 5
  const restorePresentationFocus = useCallback(
    () => presentationButton.current?.focus(),
    []
  )

  useEffect(() => {
    const controller = new AbortController()
    busy.current = true
    getCloudMetrics(selectedWindow, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setCheckedAt(Date.now())
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setCheckedAt(Date.now())
          setError(
            reason instanceof ApiError
              ? reason.message
              : "連不上伺服器，請檢查連線後重試。"
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          busy.current = false
          setRefreshing(false)
        }
      })
    return () => {
      controller.abort()
      busy.current = false
    }
  }, [selectedWindow, attempt])

  useEffect(() => {
    if (paused) return
    let timer: number
    const refresh = () => {
      if (document.visibilityState !== "hidden" && !busy.current) {
        setRefreshing(true)
        setAttempt((value) => value + 1)
      }
    }
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          refresh()
          schedule()
        },
        nextMetricRefresh(Date.now(), cadence)
      )
    }
    const onVisible = () => {
      if (document.visibilityState !== "hidden") refresh()
    }
    schedule()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [paused, cadence])

  useEffect(() => {
    const timer = window.setInterval(() => setCheckedAt(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!presenting) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    exitButton.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresenting(false)
      if (event.key === "Tab") {
        const elements = root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], select, input, [tabindex="0"]'
        )
        if (!elements?.length) return
        const first = elements[0],
          last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", keydown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", keydown)
      window.requestAnimationFrame(restorePresentationFocus)
    }
  }, [presenting, restorePresentationFocus])

  const visibleData = data?.window === selectedWindow ? data : null
  const health = metricHealth(visibleData, checkedAt, error)
  const loaded =
    visibleData?.status === "ready" || visibleData?.status === "no_data"
  const sampleAge = visibleData?.last_scraped_at
    ? Math.max(
        0,
        Math.floor(
          (checkedAt - new Date(visibleData.last_scraped_at).getTime()) / 1000
        )
      )
    : null
  const windowLabel = METRICS_WINDOWS.find(
    (item) => item.value === selectedWindow
  )!.label
  const metrics = visibleData
    ? [
        {
          label: `${windowLabel}請求量`,
          value: metricNumber(visibleData.requests_in_range),
          unit: "次",
          note: "所選時間範圍 · 樣本估算",
          accent: true,
        },
        {
          label: "每秒請求數",
          value: metricNumber(visibleData.requests_per_second, 2),
          unit: "req/s",
          note: "近一分鐘平均流量",
          accent: true,
        },
        {
          label: "成功回應比例",
          value: metricNumber(visibleData.success_percent, 2),
          unit: "%",
          note: "近一分鐘 · HTTP 2xx / 3xx",
        },
        {
          label: "p95 回應時間",
          value: metricNumber(visibleData.p95_seconds, 0, 1000),
          unit: "ms",
          note: "95% 請求低於此時間",
          warning: (visibleData.p95_seconds ?? 0) >= 1,
        },
        {
          label: "p99 回應時間",
          value: metricNumber(visibleData.p99_seconds, 0, 1000),
          unit: "ms",
          note: "觀察最慢的 1% 請求",
        },
        {
          label: "平均回應時間",
          value: metricNumber(visibleData.average_seconds, 0, 1000),
          unit: "ms",
          note: "近一分鐘 · 所有 API",
        },
        {
          label: "伺服器錯誤率",
          value: metricNumber(visibleData.error_percent, 2),
          unit: "%",
          note: "近一分鐘 · HTTP 5xx",
          warning: (visibleData.error_percent ?? 0) >= 1,
        },
        {
          label: "請求錯誤率",
          value: metricNumber(visibleData.client_error_percent, 2),
          unit: "%",
          note: "近一分鐘 · HTTP 4xx",
        },
        {
          label: "API CPU 用量",
          value: metricNumber(visibleData.cpu_cores, 3),
          unit: "核心",
          note: "API process · 近一分鐘平均",
        },
        {
          label: "API 記憶體",
          value: metricNumber(visibleData.memory_bytes, 1, 1 / 1024 ** 2),
          unit: "MiB",
          note: "API process 常駐記憶體",
        },
        {
          label: "處理中的請求",
          value: metricNumber(visibleData.in_progress),
          unit: "筆",
          note: "Cloud 最近一次收集值",
        },
        {
          label: "成功收集的實例",
          value: `${metricNumber(visibleData.instances_up)} / ${metricNumber(visibleData.instances_total)}`,
          unit: "個",
          note: "已成功收集 / 已觀測實例",
        },
      ]
    : []

  function exportSnapshot() {
    if (!visibleData) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(visibleData, null, 2)], {
        type: "application/json",
      })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `meddemo-metrics-${visibleData.window}-${visibleData.fetched_at.replace(/[:.]/g, "-")}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const panel = (
    <section
      ref={root}
      aria-labelledby="cloud-metrics-title"
      role={presenting ? "dialog" : undefined}
      aria-modal={presenting || undefined}
      className={
        presenting
          ? "fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-background p-4 md:p-8"
          : "rounded-3xl border-2 bg-card shadow-lip"
      }
    >
      <div className={cn("mx-auto", presenting && "max-w-[1600px]")}>
        <div className="rounded-t-3xl border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.15em] text-primary">
                <Activity className="size-3.5" />
                MEDDEMO · GRAFANA CLOUD
              </div>
              <h2
                id="cloud-metrics-title"
                className="mt-1.5 text-xl font-semibold tracking-tight md:text-2xl"
              >
                系統監控中心
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="監控時間範圍"
                value={selectedWindow}
                className="h-9 w-auto text-xs"
                onChange={(event) => {
                  setRefreshing(true)
                  setSelectedWindow(event.target.value as MetricsWindow)
                }}
              >
                {METRICS_WINDOWS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (paused) {
                    setRefreshing(true)
                    setAttempt((value) => value + 1)
                  }
                  setPaused((value) => !value)
                }}
                aria-label={paused ? "恢復即時更新" : "暫停畫面更新"}
                aria-pressed={paused}
              >
                {paused ? (
                  <Play className="size-3.5" />
                ) : (
                  <Pause className="size-3.5" />
                )}
                <span className="hidden sm:inline">
                  {paused ? "繼續" : "暫停"}
                </span>
              </Button>
              <Button
                ref={presenting ? exitButton : presentationButton}
                variant="outline"
                size="sm"
                aria-label={presenting ? "離開展示模式" : "進入展示模式"}
                onClick={() => setPresenting((value) => !value)}
              >
                {presenting ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
                {presenting ? "離開展示" : "展示模式"}
              </Button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl border",
                  TONE[paused ? "neutral" : health.tone]
                )}
              >
                {paused ? (
                  <Pause className="size-5" />
                ) : health.tone === "good" ? (
                  <Check className="size-5" />
                ) : (
                  <Radio className="size-5" />
                )}
              </div>
              <div role="status" aria-live="polite">
                <p className="text-sm font-semibold">
                  {paused ? "畫面已暫停" : health.label}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {paused ? "保留目前快照，可手動更新或匯出。" : health.detail}
                </p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground sm:text-right">
              <p className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    paused ? "bg-muted-foreground" : "bg-primary"
                  )}
                />
                {visibleData?.environment === "production"
                  ? "正式環境"
                  : (visibleData?.environment ?? "Cloud Metrics")}{" "}
                · 與 Grafana 共用 {cadence} 秒更新節奏
              </p>
              <p className="mt-1 tabular-nums">
                Cloud 樣本{" "}
                {visibleData?.last_scraped_at
                  ? CLOCK.format(new Date(visibleData.last_scraped_at))
                  : "—"}
                {sampleAge != null ? ` · ${sampleAge} 秒前` : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 md:space-y-5 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {windowLabel} · 流量與延遲使用近一分鐘樣本 ·{" "}
              {paused
                ? "自動更新已暫停"
                : refreshing
                  ? "正在讀取 Cloud…"
                  : "自動同步中"}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!loaded}
                onClick={exportSnapshot}
              >
                <Download className="size-3.5" />
                匯出快照
              </Button>
              {visibleData?.dashboard_url && (
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={grafanaDashboardLink(visibleData)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Grafana
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={refreshing}
                aria-label="重新整理監控數值"
                onClick={() => {
                  setRefreshing(true)
                  setAttempt((value) => value + 1)
                }}
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    refreshing && "animate-spin motion-reduce:animate-none"
                  )}
                />
                更新
              </Button>
            </div>
          </div>
          {(error || visibleData?.message) && (
            <p
              className={cn(
                "rounded-xl border px-3 py-2.5 text-sm leading-relaxed",
                TONE[health.tone]
              )}
              role="status"
            >
              {error ?? visibleData?.message}
              {error &&
                visibleData?.status === "ready" &&
                " 目前顯示上次成功取得的快照。"}
            </p>
          )}
          {!visibleData && !error && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none"
                />
              ))}
            </div>
          )}
          {loaded && visibleData && (
            <>
              <dl className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className={cn(
                      "min-w-0 rounded-2xl border p-3.5",
                      metric.accent
                        ? "border-primary/20 bg-primary/5"
                        : "bg-background",
                      metric.warning && "border-amber-500/30 bg-amber-500/5"
                    )}
                  >
                    <dt className="text-[11px] font-medium text-muted-foreground">
                      {metric.label}
                    </dt>
                    <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                      <span
                        className={cn(
                          "text-2xl font-semibold tracking-tight tabular-nums md:text-3xl",
                          metric.accent && "text-primary",
                          metric.warning && "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {metric.value}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {metric.unit}
                      </span>
                    </dd>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                      {metric.note}
                    </p>
                  </div>
                ))}
              </dl>
              <div className="grid gap-3 lg:grid-cols-2">
                <MetricChart
                  data={visibleData}
                  title="API 請求流量"
                  series={[
                    {
                      key: "requests_per_second",
                      label: "請求率",
                      color: "#8b5cf6",
                    },
                  ]}
                  unit="req/s"
                />
                <MetricChart
                  data={visibleData}
                  title="回應時間分位數"
                  series={[
                    { key: "p50_seconds", label: "p50", color: "#0ea5e9" },
                    { key: "p95_seconds", label: "p95", color: "#8b5cf6" },
                    { key: "p99_seconds", label: "p99", color: "#f59e0b" },
                  ]}
                  unit="ms"
                  multiplier={1000}
                  digits={0}
                />
                <MetricChart
                  data={visibleData}
                  title="HTTP 錯誤比率"
                  series={[
                    {
                      key: "client_error_percent",
                      label: "4xx",
                      color: "#f59e0b",
                    },
                    { key: "error_percent", label: "5xx", color: "#f43f5e" },
                  ]}
                  unit="%"
                />
                <MetricChart
                  data={visibleData}
                  title="處理中請求"
                  series={[
                    { key: "in_progress", label: "處理中", color: "#0ea5e9" },
                  ]}
                  unit="筆"
                  digits={0}
                />
                <MetricChart
                  data={visibleData}
                  title="API CPU 用量"
                  series={[
                    { key: "cpu_cores", label: "CPU", color: "#8b5cf6" },
                  ]}
                  unit="核心"
                  digits={3}
                />
                <MetricChart
                  data={visibleData}
                  title="API 記憶體用量"
                  series={[
                    { key: "memory_bytes", label: "記憶體", color: "#10b981" },
                  ]}
                  unit="MiB"
                  multiplier={1 / 1024 ** 2}
                  digits={1}
                />
              </div>
              <div className="grid items-start gap-3 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2">
                  <RouteRanking data={visibleData} />
                </div>
                <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <StatusDistribution data={visibleData} />
                  <InstanceStatus data={visibleData} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
  return presenting ? createPortal(panel, document.body) : panel
}
