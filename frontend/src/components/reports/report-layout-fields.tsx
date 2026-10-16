import { useState } from "react"
import {
  defaultMobileLayout,
  desktopReportRects,
  REPORT_ROW,
  validDesktopRect,
} from "@/lib/report-layout"
import type {
  ReportCard,
  ReportConfig,
  ReportDesktopLayout,
} from "@/lib/reports"

const CONTROL =
  "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
export function ReportLayoutFields({
  card,
  config,
  mobile,
  onChange,
}: {
  card: ReportCard
  config: ReportConfig
  mobile: boolean
  onChange: (patch: Partial<ReportCard>) => void
}) {
  const cards = config.cards.filter(
    (item) => (item.page_id ?? "overview") === (card.page_id ?? "overview")
  )
  const free =
    config.pages?.find((page) => page.id === (card.page_id ?? "overview"))
      ?.desktop_layout === "free"
  const phone = defaultMobileLayout(card, cards.indexOf(card))
  const rect = desktopReportRects(cards)[card.id]
  return (
    <div
      className="space-y-4"
      aria-label={mobile ? "手機圖表版面" : "桌機圖表版面"}
    >
      <p className="text-xs font-medium">
        {mobile ? "手機獨立版面" : free ? "桌機自由版面" : "桌機自動格線"}
      </p>
      {mobile ? (
        <>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="在手機顯示此圖表"
              checked={!phone.hidden}
              onChange={(event) =>
                onChange({
                  mobile_layout: { ...phone, hidden: !event.target.checked },
                })
              }
            />
            在手機顯示此圖表
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>手機圖表寬度</span>
            <select
              className={CONTROL}
              aria-label="手機圖表寬度"
              value={phone.width}
              onChange={(event) =>
                onChange({
                  mobile_layout: {
                    ...phone,
                    width: event.target.value as "half" | "full",
                  },
                })
              }
            >
              <option value="half">半寬</option>
              <option value="full">全寬</option>
            </select>
          </label>
          <MobileHeight
            key={`${card.id}/${phone.height}`}
            value={phone.height}
            onChange={(height) =>
              onChange({ mobile_layout: { ...phone, height } })
            }
          />
          <button
            type="button"
            className="min-h-10 w-full rounded-md border px-2 text-sm"
            disabled={!card.mobile_layout}
            onClick={() => onChange({ mobile_layout: null })}
          >
            還原此圖表的手機預設
          </button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            僅套用手機版。隱藏的圖表可從「版面清單」選取；調整後與桌機分開保存。
          </p>
        </>
      ) : free ? (
        <DesktopFields
          key={`${card.id}/${JSON.stringify(rect)}`}
          value={rect}
          onChange={(desktop_layout) => onChange({ desktop_layout })}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-sm">
            <span>圖表寬度</span>
            <select
              className={CONTROL}
              aria-label="圖表寬度"
              value={card.width ?? "half"}
              onChange={(event) =>
                onChange({ width: event.target.value as ReportCard["width"] })
              }
            >
              <option value="half">
                {card.visual === "kpi" ? "指標格" : "半寬"}
              </option>
              <option value="full">全寬</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>圖表高度</span>
            <select
              className={CONTROL}
              aria-label="圖表高度"
              value={card.height ?? "regular"}
              onChange={(event) =>
                onChange({ height: event.target.value as ReportCard["height"] })
              }
            >
              <option value="compact">緊湊</option>
              <option value="regular">標準</option>
              <option value="tall">加高</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

function MobileHeight({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const parsed = Number(draft)
  const valid =
    draft !== "" && Number.isInteger(parsed) && parsed >= 8 && parsed <= 60
  return (
    <div className="space-y-2">
      <label className="block space-y-1.5 text-sm">
        <span>手機圖表高度（格）</span>
        <input
          className={CONTROL}
          aria-label="手機圖表高度（格）"
          type="number"
          min={8}
          max={60}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        每格 {REPORT_ROW}px，8–60 格。
        {valid && `目前 ${parsed * REPORT_ROW}px。`}
        內容較長時可在圖表內捲動或放大檢視。
      </p>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          請輸入 8–60 的整數高度。
        </p>
      )}
      <button
        type="button"
        className="min-h-10 w-full rounded-md border px-2 text-sm disabled:opacity-40"
        disabled={!valid}
        onClick={() => onChange(parsed)}
      >
        套用手機高度
      </button>
    </div>
  )
}

function DesktopFields({
  value,
  onChange,
}: {
  value: ReportDesktopLayout
  onChange: (value: ReportDesktopLayout) => void
}) {
  const [draft, setDraft] = useState(
    Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, String(value)])
    )
  )
  const parsed = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, Number(value)])
  ) as ReportDesktopLayout
  const valid =
    Object.values(draft).every((value) => value.trim() !== "") &&
    validDesktopRect(parsed)
  const fields = [
    { key: "x", label: "水平位置", min: 0, max: 20 },
    { key: "y", label: "垂直位置", min: 0, max: 400 },
    { key: "w", label: "寬度", min: 4, max: 24 },
    { key: "h", label: "高度", min: 8, max: 60 },
  ] as const
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <label key={field.key} className="block space-y-1.5 text-sm">
            <span>{field.label}（格）</span>
            <input
              className={CONTROL}
              aria-label={`桌機${field.label}（格）`}
              type="number"
              step={0.1}
              min={field.min}
              max={field.max}
              value={draft[field.key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          位置或尺寸超出範圍：水平位置＋寬度不得超過 24，高度需為 8–60 格。
        </p>
      )}
      <button
        type="button"
        className="min-h-10 w-full rounded-md border px-2 text-sm disabled:opacity-40"
        disabled={!valid}
        onClick={() => onChange(parsed)}
      >
        套用桌機位置與尺寸
      </button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        畫布寬 24 格；每列 {REPORT_ROW}
        px。拖曳右下角可調整寬高，關閉吸附後可微調至 0.1
        格。較長內容可捲動或放大檢視。
      </p>
    </div>
  )
}
