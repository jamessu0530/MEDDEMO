import { useEffect, useState } from "react"
import {
  APIProvider,
  AdvancedMarker,
  Map,
  useMap,
} from "@vis.gl/react-google-maps"
import { getMapsConfig, type MapsConfig } from "@/api/maps"
import {
  chartSelection,
  formatReportExactValue,
  type CardData,
  type ReportCard,
  type ReportPoint,
  type ReportSelectionPoint,
} from "@/lib/reports"

type Props = {
  card: ReportCard
  data: CardData
  onSelect?: (point: ReportSelectionPoint) => void
  onHover?: (point: ReportSelectionPoint) => void
  onLeave?: () => void
}
function events(props: Props, point: ReportPoint) {
  const selection = chartSelection(props.card, point)
  return {
    role: props.onSelect ? ("button" as const) : undefined,
    tabIndex: props.onSelect ? 0 : undefined,
    onClick: () => props.onSelect?.(selection),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        props.onSelect?.(selection)
      }
    },
    onMouseEnter: () => props.onHover?.(selection),
    onMouseLeave: props.onLeave,
    onFocus: () => props.onHover?.(selection),
    onBlur: props.onLeave,
    "aria-label": `${point.label}：${formatReportExactValue(point.value, props.card.metric)}`,
  }
}
export function StageChart(props: Props) {
  const { card, data } = props
  const points = data.points.filter((point) => point.value !== null)
  if (card.visual === "funnel") {
    if (points.some((point) => point.value! < 0))
      return (
        <p role="status" className="text-xs">
          漏斗圖需要非負數值；請改用長條圖呈現負值。
        </p>
      )
    const max = Math.max(1, ...points.map((point) => point.value!))
    return (
      <div className="space-y-2">
        {points.map((point, index) => (
          <button
            key={point.key}
            type="button"
            disabled={!props.onSelect}
            {...events(props, point)}
            className="block min-h-12 w-full rounded border p-2 text-sm disabled:opacity-100"
          >
            <span className="block truncate">
              {index + 1}. {point.label} ·{" "}
              {formatReportExactValue(point.value, card.metric)}
            </span>
            <span
              className="mx-auto mt-1 block h-5 rounded-sm"
              style={{
                width: `${Math.max(1, (point.value! / max) * 100)}%`,
                background: card.color,
              }}
            />
            {index > 0 && (
              <span className="text-xs text-muted-foreground">
                相鄰階段比例：
                {points[index - 1].value
                  ? `${((point.value! / points[index - 1].value!) * 100).toFixed(1)}%`
                  : "前階段為零，無法計算"}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }
  let cumulative = 0
  const steps = points.map((point) => {
    const start = cumulative
    cumulative += point.value!
    return { point, start, end: cumulative }
  })
  const values = [0, ...steps.flatMap((step) => [step.start, step.end])]
  const low = Math.min(...values),
    high = Math.max(...values),
    span = high - low || 1
  const y = (value: number) => 210 - ((value - low) / span) * 180
  const width = 600,
    band = (width - 70) / Math.max(1, steps.length)
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} 265`}
        role="img"
        aria-label={`${card.title}累積瀑布圖`}
        className="w-full"
      >
        <line
          x1="40"
          x2="590"
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          opacity=".3"
        />
        {steps.map(({ point, start, end }, index) => (
          <g
            key={point.key}
            {...events(props, point)}
            className="cursor-pointer"
          >
            <title>
              {point.label}：{formatReportExactValue(point.value, card.metric)}
              ；累積 {formatReportExactValue(end, card.metric)}
            </title>
            <rect
              x={45 + band * index}
              y={Math.min(y(start), y(end))}
              width={Math.max(3, band - 8)}
              height={Math.max(2, Math.abs(y(start) - y(end)))}
              fill={point.value! >= 0 ? (card.color ?? "#6455c7") : "#d76857"}
            />
            <text
              x={45 + band * (index + 0.45)}
              y="232"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {point.label.slice(0, 7)}
            </text>
            {index < steps.length - 1 && (
              <line
                x1={45 + band * (index + 1) - 8}
                x2={45 + band * (index + 1)}
                y1={y(end)}
                y2={y(end)}
                stroke="currentColor"
                opacity=".4"
              />
            )}
          </g>
        ))}
      </svg>
      <p className="text-xs text-muted-foreground">
        已顯示分組累積：{formatReportExactValue(cumulative, card.metric)}
        。未顯示的分組不包含在累積終點。
      </p>
    </div>
  )
}
export function AnalysisChart(props: Props) {
  const { card, data } = props
  const analysis = data.analysis
  if (!analysis) return null
  const actual = data.points
  const forecasts = analysis.forecast
  const keys = [
    ...new Set([
      ...actual.map((point) => point.key),
      ...forecasts.map((point) => point.key),
    ]),
  ].sort()
  const all = [...actual, ...analysis.trend, ...forecasts].filter(
    (point) => point.value != null
  )
  const low = Math.min(0, ...all.map((point) => point.value!)),
    high = Math.max(0, ...all.map((point) => point.value!)),
    span = high - low || 1
  const x = (key: string) =>
    45 + (keys.indexOf(key) / Math.max(1, keys.length - 1)) * 500
  const y = (value: number) => 210 - ((value - low) / span) * 175
  const line = (points: { key: string; value: number | null }[]) =>
    points
      .filter((point) => point.value != null)
      .map((point) => `${x(point.key)},${y(point.value!)}`)
      .join(" ")
  const last = analysis.trend.at(-1)
  return (
    <div className="space-y-2">
      <svg
        viewBox="0 0 590 260"
        className="w-full"
        role="img"
        aria-label={`${card.title}實際值、線性趨勢與預測`}
      >
        <line
          x1="45"
          x2="560"
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          opacity=".3"
        />
        <polyline
          fill="none"
          stroke={card.color ?? "#6455c7"}
          strokeWidth="2"
          points={line(
            actual.filter(
              (point) => !forecasts.some((f) => f.key === point.key)
            )
          )}
        />
        {card.analytics?.trend_line && (
          <polyline
            fill="none"
            stroke="#259688"
            strokeWidth="2"
            points={line(analysis.trend)}
          />
        )}
        {forecasts.length > 0 && (
          <polyline
            fill="none"
            stroke="#d76857"
            strokeWidth="2"
            strokeDasharray="6 4"
            points={line([...(last ? [last] : []), ...forecasts])}
          />
        )}
        {actual
          .filter(
            (point) =>
              point.value != null && !forecasts.some((f) => f.key === point.key)
          )
          .map((point) => (
            <g key={point.key} {...events(props, point)}>
              <circle
                cx={x(point.key)}
                cy={y(point.value!)}
                r="5"
                fill={card.color ?? "#6455c7"}
              />
              <title>
                {point.label}：
                {formatReportExactValue(point.value, card.metric)}
              </title>
            </g>
          ))}
        {keys
          .filter(
            (_, index) =>
              index === 0 ||
              index === keys.length - 1 ||
              index % Math.max(1, Math.ceil(keys.length / 5)) === 0
          )
          .map((key) => (
            <text
              key={key}
              x={x(key)}
              y="236"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {key}
            </text>
          ))}
      </svg>
      <p className="text-xs text-muted-foreground">
        實線：實際值{card.analytics?.trend_line ? "／綠色：線性趨勢" : ""}
        {forecasts.length ? "／橘色虛線：預測" : ""}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {analysis.note}{" "}
        {forecasts.length > 0 && "與預測同區間的未完成實際值保留於分組彙總。"}
      </p>
      {forecasts.length > 0 && (
        <details className="text-xs">
          <summary className="min-h-9 cursor-pointer">預測數值</summary>
          <table className="w-full">
            <tbody>
              {forecasts.map((point) => (
                <tr key={point.key}>
                  <th className="py-1 text-left font-normal">{point.label}</th>
                  <td className="text-right">
                    {formatReportExactValue(point.value, card.metric)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
export function ReportMap(props: Props) {
  const [config, setConfig] = useState<MapsConfig>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getMapsConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setConfig(value)
          setReady(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setReady(true)
      })
    return () => controller.abort()
  }, [])
  const points = props.data.points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat!) <= 90 &&
      Math.abs(point.lng!) <= 180
  )
  if (!points.length)
    return (
      <p role="status" className="text-xs">
        目前分組沒有有效座標。地圖不會依客戶名稱猜測位置。
      </p>
    )
  return (
    <div className="space-y-2">
      {config ? (
        <APIProvider apiKey={config.browser_key}>
          <div className="h-72 overflow-hidden rounded-lg">
            <Map
              mapId={config.map_id}
              defaultZoom={8}
              defaultCenter={{ lat: points[0].lat!, lng: points[0].lng! }}
              gestureHandling="cooperative"
              disableDefaultUI
            >
              <FitPoints points={points} />
              {points.map((point) => (
                <AdvancedMarker
                  key={point.key}
                  position={{ lat: point.lat!, lng: point.lng! }}
                  title={`${point.label}：${formatReportExactValue(point.value, props.card.metric)}`}
                  onClick={() =>
                    props.onSelect?.(chartSelection(props.card, point))
                  }
                >
                  <span
                    className="block size-7 rounded-full border-2 border-white shadow-md"
                    style={{ background: props.card.color ?? "#6455c7" }}
                  />
                </AdvancedMarker>
              ))}
            </Map>
          </div>
        </APIProvider>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {ready
            ? "目前未設定地圖服務，仍可查看下方客戶座標。"
            : "正在載入地圖…"}
        </p>
      )}
      <details className="text-xs">
        <summary className="min-h-9 cursor-pointer">客戶座標與數值</summary>
        {points.map((point) => (
          <button
            type="button"
            key={point.key}
            className="block min-h-9 w-full text-left"
            {...events(props, point)}
          >
            {point.label} · {point.lat!.toFixed(4)}, {point.lng!.toFixed(4)} ·{" "}
            {formatReportExactValue(point.value, props.card.metric)}
          </button>
        ))}
      </details>
    </div>
  )
}
function FitPoints({ points }: { points: ReportPoint[] }) {
  const map = useMap()
  const key = points.map((point) => `${point.lat},${point.lng}`).join(";")
  useEffect(() => {
    if (!map || !key) return
    const coordinates = key
      .split(";")
      .map((pair) => pair.split(",").map(Number))
    const bounds = new google.maps.LatLngBounds()
    coordinates.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
    map.fitBounds(bounds, 40)
    if (coordinates.length === 1) map.setZoom(12)
  }, [map, key]) // Coordinates are the complete bounds dependency.
  return null
}
