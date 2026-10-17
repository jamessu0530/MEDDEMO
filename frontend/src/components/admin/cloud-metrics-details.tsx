import { useState } from "react"

import type { CloudMetrics } from "@/api/cloud-metrics"
import { ArrowDownWideNarrow, Server } from "@/components/icons"
import { NativeSelect } from "@/components/ui/native-select"
import {
  metricNumber,
  metricUptime,
  rankedRoutes,
  type RouteSort,
} from "@/lib/cloud-metrics"
import { cn } from "@/lib/utils"

const STATUS_GROUPS = [
  { prefix: "2", label: "2xx 成功", color: "#10b981" },
  { prefix: "3", label: "3xx 重新導向", color: "#0ea5e9" },
  { prefix: "4", label: "4xx 請求錯誤", color: "#f59e0b" },
  { prefix: "5", label: "5xx 伺服器錯誤", color: "#f43f5e" },
  { prefix: "1", label: "1xx 資訊", color: "#8b5cf6" },
]

export function StatusDistribution({ data }: { data: CloudMetrics }) {
  const hasSamples = data.status_codes.length > 0
  const total = data.status_codes.reduce((sum, item) => sum + item.requests, 0)
  const groups = STATUS_GROUPS.map((group) => ({
    ...group,
    value: data.status_codes
      .filter((item) => item.status.startsWith(group.prefix))
      .reduce((sum, item) => sum + item.requests, 0),
  }))
  let offset = 0
  const segments = groups
    .map((group) => {
      const start = offset
      offset += total > 0 ? (group.value / total) * 100 : 0
      return `${group.color} ${start}% ${offset}%`
    })
    .join(", ")
  return (
    <article className="rounded-2xl border bg-card p-4">
      <h3 className="text-sm font-semibold">HTTP 回應分布</h3>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
        <div
          className="relative grid size-36 shrink-0 place-items-center rounded-full"
          style={{
            background:
              total > 0 ? `conic-gradient(${segments})` : "var(--muted)",
          }}
          role="img"
          aria-label={
            hasSamples ? `${metricNumber(total)} 次請求` : "尚無狀態碼樣本"
          }
        >
          <div className="grid size-28 place-content-center rounded-full bg-card text-center">
            <span className="text-2xl font-semibold tabular-nums">
              {hasSamples ? metricNumber(total) : "—"}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">
              請求總數
            </span>
          </div>
        </div>
        <ul className="min-w-40 flex-1 space-y-2.5">
          {groups.map((group) => (
            <li
              key={group.prefix}
              className="flex items-center justify-between gap-4 text-xs"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                {group.label}
              </span>
              <span className="font-medium tabular-nums">
                {total > 0
                  ? `${metricNumber((group.value / total) * 100, 1)}%`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 border-t pt-3">
        {data.status_codes
          .filter((item) => item.requests > 0)
          .map((item) => (
            <span
              key={item.status}
              className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums"
            >
              {item.status}{" "}
              <span className="text-muted-foreground">
                · {metricNumber(item.requests)}
              </span>
            </span>
          ))}
        {!total && (
          <p className="text-xs text-muted-foreground">
            {hasSamples ? "此時間範圍沒有完成請求" : "沒有可用的狀態碼樣本"}
          </p>
        )}
      </div>
    </article>
  )
}

export function RouteRanking({ data }: { data: CloudMetrics }) {
  const [sort, setSort] = useState<RouteSort>("requests")
  const [filter, setFilter] = useState("")
  const routes = rankedRoutes(
    data.routes.filter((route) =>
      `${route.method} ${route.route}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    ),
    sort
  ).slice(0, 10)
  const max = Math.max(...routes.map((route) => route.requests ?? 0), 1)
  return (
    <article className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ArrowDownWideNarrow className="size-4 text-primary" />
            API 功能排行
          </h3>
        </div>
        <NativeSelect
          aria-label="API 排行方式"
          value={sort}
          onChange={(event) => setSort(event.target.value as RouteSort)}
          className="h-9 w-auto text-xs"
        >
          <option value="requests">依請求量</option>
          <option value="p95_seconds">依回應時間</option>
          <option value="server_errors">依伺服器錯誤數</option>
        </NativeSelect>
      </div>
      <input
        type="search"
        aria-label="搜尋 API 路徑"
        placeholder="搜尋功能路徑，例如 /api/asks"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="mt-3 h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[500px] text-left text-xs">
          <thead className="border-b text-[10px] text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">API 功能</th>
              <th className="px-3 pb-2 text-right font-medium">請求數</th>
              <th className="px-3 pb-2 text-right font-medium">p95</th>
              <th className="px-3 pb-2 text-right font-medium">4xx</th>
              <th className="pb-2 text-right font-medium">5xx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {routes.map((route) => (
              <tr key={`${route.method} ${route.route}`}>
                <td className="max-w-60 py-3 pr-3">
                  <div className="flex items-start gap-2">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                      {route.method}
                    </span>
                    <span className="font-mono text-[11px] leading-relaxed break-all">
                      {route.route}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/50 transition-[width] duration-500 motion-reduce:transition-none"
                      style={{
                        width: `${((route.requests ?? 0) / max) * 100}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {metricNumber(route.requests)}
                </td>
                <td
                  className={cn(
                    "px-3 py-3 text-right tabular-nums",
                    (route.p95_seconds ?? 0) >= 1 &&
                      "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {metricNumber(route.p95_seconds, 0, 1000)}
                  <span className="ml-0.5 text-[10px] text-muted-foreground">
                    ms
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                  {metricNumber(route.client_errors)}
                </td>
                <td
                  className={cn(
                    "py-3 text-right tabular-nums",
                    (route.server_errors ?? 0) > 0 &&
                      "font-semibold text-destructive"
                  )}
                >
                  {metricNumber(route.server_errors)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!routes.length && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {filter ? "沒有符合的 API 路徑" : "等待 API 流量樣本"}
          </p>
        )}
      </div>
    </article>
  )
}

export function InstanceStatus({ data }: { data: CloudMetrics }) {
  return (
    <article className="rounded-2xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Server className="size-4 text-primary" />
        API 實例狀態
      </h3>
      <div className="mt-4 space-y-3">
        {data.instances.map((instance) => (
          <div
            key={instance.instance}
            className="rounded-xl border bg-background p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 font-mono text-xs font-medium break-all">
                {instance.instance}
              </span>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-[11px]",
                  instance.up === 1
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    instance.up === 1 ? "bg-emerald-500" : "bg-destructive"
                  )}
                />
                {instance.up === 1
                  ? "收集正常"
                  : instance.up === 0
                    ? "收集失敗"
                    : "尚無樣本"}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
              <div>
                <dt className="text-[10px] text-muted-foreground">CPU 核心</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {metricNumber(instance.cpu_cores, 3)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">
                  記憶體 MiB
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {metricNumber(instance.memory_bytes, 1, 1 / 1024 ** 2)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">
                  處理中請求
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {metricNumber(instance.in_progress)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">運行時間</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {metricUptime(instance.uptime_seconds)}
                </dd>
              </div>
            </dl>
          </div>
        ))}
        {!data.instances.length && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            尚未收到實例指標
          </p>
        )}
      </div>
    </article>
  )
}
