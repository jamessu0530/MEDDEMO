import { BarChart3, ChevronDown } from "lucide-react"

import {
  DIMENSIONS,
  METRICS,
  formatReportValue,
  type CardData,
  type ReportCard,
} from "@/lib/reports"

function exactValue(value: number, card: ReportCard): string {
  const isCurrency = METRICS[card.metric].unit === "currency"
  const unit = isCurrency ? "元" : card.metric === "visits" ? "次" : "家"
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: isCurrency ? 2 : 0 })} ${unit}`
}

function Total({ card, total, large = false }: { card: ReportCard; total: number; large?: boolean }) {
  const formatted = formatReportValue(total, card.metric)
  const exact = exactValue(total, card)
  return (
    <div className={large ? "py-2" : "mb-4"}>
      <p className="mb-1 text-xs text-muted-foreground">所選範圍合計</p>
      <p className={`${large ? "text-[clamp(1.125rem,5.5vw,1.625rem)] sm:text-3xl" : "text-2xl"} break-words font-bold leading-tight tracking-tight tabular-nums ${total < 0 ? "text-destructive" : "text-foreground"}`} title={exact}>
        {formatted}
      </p>
      {formatted !== exact && <p className="mt-1 break-words text-xs text-muted-foreground tabular-nums">{exact}</p>}
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
      <BarChart3 className="size-6 opacity-60" aria-hidden="true" />
      <p>目前範圍沒有資料</p>
      <p className="text-xs">可以調整期間或篩選條件。</p>
    </div>
  )
}

function BarChart({ card, data }: { card: ReportCard; data: CardData }) {
  const minimum = Math.min(0, ...data.points.map((point) => point.value))
  const maximum = Math.max(0, ...data.points.map((point) => point.value))
  const span = maximum - minimum || 1
  const baseline = (-minimum / span) * 100

  return (
    <ol className="space-y-3.5" aria-label={`${card.title}，${DIMENSIONS[card.dimension]}比較`}>
      {data.points.map((point) => {
        const left = ((Math.min(0, point.value) - minimum) / span) * 100
        const width = (Math.abs(point.value) / span) * 100
        return (
          <li key={point.key} className="space-y-1.5">
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{point.label}</span>
              <span className={`shrink-0 text-right text-xs tabular-nums ${point.value < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {exactValue(point.value, card)}
              </span>
            </div>
            <div className="relative h-3.5 overflow-hidden rounded-md bg-muted/60" aria-hidden="true">
              <span className="absolute inset-y-0 z-10 w-px bg-muted-foreground/60" style={{ left: `${Math.min(99.8, baseline)}%` }} />
              <span
                className={`absolute inset-y-0 rounded-sm ${point.value < 0 ? "bg-destructive/80" : "bg-primary"}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ValueTable({ card, data, compact = false }: { card: ReportCard; data: CardData; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className={`w-full table-fixed text-left ${compact ? "text-xs" : "text-sm"}`}>
        <caption className="sr-only">{card.title}明細</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-[52%] px-3 py-2.5 font-medium">{DIMENSIONS[card.dimension]}</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">{METRICS[card.metric].label}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.points.map((point) => (
            <tr key={point.key}>
              <th scope="row" className="break-words px-3 py-2.5 font-normal">{point.label}</th>
              <td className={`break-words px-3 py-2.5 text-right tabular-nums ${point.value < 0 ? "text-destructive" : "text-foreground"}`}>
                {exactValue(point.value, card)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LineChart({ card, data }: { card: ReportCard; data: CardData }) {
  const width = 340
  const height = 164
  const left = 14
  const right = width - 14
  const top = 18
  const bottom = height - 28
  const minimum = Math.min(0, ...data.points.map((point) => point.value))
  const maximum = Math.max(0, ...data.points.map((point) => point.value))
  const span = maximum - minimum || 1
  const padding = span * 0.12
  const lower = minimum - padding
  const upper = maximum + padding
  const x = (index: number) => data.points.length === 1 ? width / 2 : left + (index / (data.points.length - 1)) * (right - left)
  const y = (value: number) => bottom - ((value - lower) / (upper - lower)) * (bottom - top)
  const points = data.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")
  const labelStep = Math.max(1, Math.ceil(data.points.length / 5))

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={`${card.title}趨勢，可展開查看各月數值`}>
        <title>{`${card.title}逐月趨勢`}</title>
        {[top, (top + bottom) / 2, bottom].map((position) => (
          <line key={position} x1={left} x2={right} y1={position} y2={position} className="stroke-border" strokeDasharray="3 4" />
        ))}
        <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/60" strokeWidth="1" />
        <text x={left + 2} y={y(0) - 5} fontSize="10" className="fill-muted-foreground">0</text>
        <polyline points={points} fill="none" className="stroke-primary" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {data.points.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.value)} r="4" className={point.value < 0 ? "fill-destructive stroke-card" : "fill-primary stroke-card"} strokeWidth="2">
              <title>{`${point.label}：${exactValue(point.value, card)}`}</title>
            </circle>
            {(index % labelStep === 0 || index === data.points.length - 1) && (
              <text x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === data.points.length - 1 ? "end" : "middle"} fontSize="11" className="fill-muted-foreground">
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <details className="group rounded-2xl border border-border bg-muted/20">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3 py-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          查看各月數值
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="px-3 pb-3"><ValueTable card={card} data={data} compact /></div>
      </details>
    </div>
  )
}

export function ReportChart({ card, data }: { card: ReportCard; data: CardData }) {
  if (card.visual === "kpi") {
    return <Total card={card} total={data.total} large />
  }

  return (
    <div className="min-w-0">
      <Total card={card} total={data.total} />
      {data.points.length === 0 ? <EmptyChart /> : card.visual === "table" ? (
        <ValueTable card={card} data={data} />
      ) : card.visual === "line" && card.dimension === "month" ? (
        <LineChart card={card} data={data} />
      ) : (
        <BarChart card={card} data={data} />
      )}
    </div>
  )
}
