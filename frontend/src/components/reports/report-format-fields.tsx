import { useId, useState } from "react"
import { DISPLAY_UNITS, reportSeriesColor } from "@/lib/report-format"
import {
  METRICS,
  reportMatrixOptions,
  type CardData,
  type ReportCard,
  type ReportConditionalFormat,
  type ReportColorRule,
  type ReportMetric,
} from "@/lib/reports"

const CONTROL =
  "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-xs"
function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState({ value, text: value })
  if (draft.value !== value) setDraft({ value, text: value })
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft.text)
  return (
    <label className="block min-w-0 space-y-1 text-sm">
      <span>{label}</span>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label}色票`}
          value={value}
          className="h-10 w-10 shrink-0 rounded border bg-background p-1"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          aria-label={label}
          value={draft.text}
          maxLength={7}
          className={`${CONTROL} font-mono`}
          aria-invalid={!valid || undefined}
          onChange={(e) => {
            const text = e.target.value
            const accepted = /^#[0-9a-fA-F]{6}$/.test(text)
            setDraft({ value: accepted ? text : value, text })
            if (accepted) onChange(text)
          }}
          onBlur={() => {
            if (!valid) setDraft({ value, text: value })
          }}
        />
      </div>
    </label>
  )
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
    </label>
  )
}
function Bounds({
  label,
  minimum,
  maximum,
  percentage,
  bars = false,
  onApply,
}: {
  label: string
  minimum?: number | null
  maximum?: number | null
  percentage: boolean
  bars?: boolean
  onApply: (minimum: number | null, maximum: number | null) => void
}) {
  const factor = percentage ? 100 : 1
  const [lower, setLower] = useState(
    minimum == null ? "" : String(minimum * factor)
  )
  const [upper, setUpper] = useState(
    maximum == null ? "" : String(maximum * factor)
  )
  const min = lower === "" ? null : Number(lower) / factor
  const max = upper === "" ? null : Number(upper) / factor
  const valid =
    (min == null || (Number.isFinite(min) && Math.abs(min) <= 1e15)) &&
    (max == null || (Number.isFinite(max) && Math.abs(max) <= 1e15)) &&
    (min == null || max == null || min < max) &&
    (!bars || ((min == null || min <= 0) && (max == null || max >= 0)))
  return (
    <fieldset className="space-y-2 rounded border p-2">
      <legend className="px-1 text-xs">
        {label}
        {percentage ? "（%）" : ""}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-sm">
          下限
          <input
            aria-label={`${label}下限`}
            type="number"
            step="any"
            placeholder="自動"
            value={lower}
            onChange={(e) => setLower(e.target.value)}
            className={CONTROL}
          />
        </label>
        <label className="space-y-1 text-sm">
          上限
          <input
            aria-label={`${label}上限`}
            type="number"
            step="any"
            placeholder="自動"
            value={upper}
            onChange={(e) => setUpper(e.target.value)}
            className={CONTROL}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!valid}
        className="min-h-9 rounded border px-2 text-sm disabled:opacity-40"
        onClick={() => onApply(min, max)}
      >
        套用{label}
      </button>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          請輸入有效範圍；下限小於上限{bars ? "，資料條範圍須包含零" : ""}。
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        留空使用自動範圍。超界數值使用邊界色彩／長度，原值仍可查閱。
      </p>
    </fieldset>
  )
}
function RuleEditor({
  rule,
  index,
  percentage,
  onChange,
  onRemove,
}: {
  rule: ReportColorRule
  index: number
  percentage: boolean
  onChange: (rule: ReportColorRule) => void
  onRemove: () => void
}) {
  const factor = percentage ? 100 : 1
  const [minimum, setMinimum] = useState(
    rule.minimum == null ? "" : String(rule.minimum * factor)
  )
  const [maximum, setMaximum] = useState(
    rule.maximum == null ? "" : String(rule.maximum * factor)
  )
  const lower = minimum === "" ? null : Number(minimum) / factor,
    upper = maximum === "" ? null : Number(maximum) / factor
  const valid =
    (lower == null || (Number.isFinite(lower) && Math.abs(lower) <= 1e15)) &&
    (upper == null || (Number.isFinite(upper) && Math.abs(upper) <= 1e15)) &&
    (lower == null || upper == null || lower < upper)
  return (
    <div className="space-y-2 rounded border p-2">
      <p className="text-xs">
        規則 {index + 1}
        {percentage ? "（%）" : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-sm">
          大於等於
          <input
            type="number"
            step="any"
            aria-label={`規則 ${index + 1}下限`}
            placeholder="不限"
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            className={CONTROL}
          />
        </label>
        <label className="space-y-1 text-sm">
          小於
          <input
            type="number"
            step="any"
            aria-label={`規則 ${index + 1}上限`}
            placeholder="不限"
            value={maximum}
            onChange={(e) => setMaximum(e.target.value)}
            className={CONTROL}
          />
        </label>
      </div>
      <ColorInput
        label={`規則 ${index + 1}顏色`}
        value={rule.color}
        onChange={(color) => onChange({ ...rule, color })}
      />
      <div className="flex justify-between gap-2">
        <button
          type="button"
          disabled={!valid}
          className="min-h-9 text-sm text-primary disabled:opacity-40"
          onClick={() => onChange({ ...rule, minimum: lower, maximum: upper })}
        >
          套用規則 {index + 1}
        </button>
        <button
          type="button"
          className="min-h-9 text-sm text-destructive"
          onClick={onRemove}
        >
          移除規則 {index + 1}
        </button>
      </div>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          下限需小於上限，數值須有效。
        </p>
      )}
    </div>
  )
}

export function ReportFormatFields({
  card,
  data,
  onChange,
}: {
  card: ReportCard
  data?: CardData
  onChange: (patch: Partial<ReportCard>) => void
}) {
  const id = useId()
  const metrics =
    card.visual === "matrix"
      ? reportMatrixOptions(card).metrics
      : [card.metric, ...(card.secondary_metric ? [card.secondary_metric] : [])]
  const [chosen, setChosen] = useState<ReportMetric>(card.metric)
  const metric = metrics.includes(chosen) ? chosen : card.metric
  const format = card.format ?? {}
  const number = format.numbers?.[metric] ?? {}
  const conditional = format.conditional?.[metric] ?? {}
  const percentage = METRICS[metric].unit === "percent"
  const table = card.visual === "table" || card.visual === "matrix"
  const update = (patch: Partial<NonNullable<ReportCard["format"]>>) =>
    onChange({ format: { ...format, ...patch } })
  const updateNumber = (patch: Partial<typeof number>) =>
    update({
      numbers: { ...format.numbers, [metric]: { ...number, ...patch } },
    })
  const updateConditional = (patch: Partial<ReportConditionalFormat>) =>
    update({
      conditional: {
        ...format.conditional,
        [metric]: { ...conditional, ...patch },
      },
    })
  const colorItems =
    card.visual === "matrix"
      ? []
      : card.legend
        ? (data?.series ?? [])
        : ["pie", "donut", "treemap", "bar", "column", "scatter"].includes(
              card.visual
            )
          ? (data?.points ?? [])
          : []
  const colorDimension = card.legend ?? card.dimension
  const axes = format.axes ?? {}
  const cartesian = [
    "bar",
    "column",
    "stacked_bar",
    "stacked_column",
    "percent_bar",
    "percent_column",
    "line",
    "area",
    "combo",
    "scatter",
  ].includes(card.visual)
  const tooltip = format.tooltip ?? {}
  return (
    <div className="space-y-4 border-t pt-3">
      <label className="block space-y-1 text-sm">
        設定指標
        <select
          aria-label="格式設定指標"
          className={CONTROL}
          value={metric}
          onChange={(e) => setChosen(e.target.value as ReportMetric)}
        >
          {metrics.map((key) => (
            <option key={key} value={key}>
              {METRICS[key].label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2 rounded border p-2">
        <legend className="px-1 text-xs font-medium">數值格式</legend>
        <label className="block space-y-1 text-sm">
          顯示單位
          <select
            aria-label="數值顯示單位"
            className={CONTROL}
            value={number.unit ?? "auto"}
            onChange={(e) =>
              updateNumber({ unit: e.target.value as typeof number.unit })
            }
          >
            {Object.entries(DISPLAY_UNITS)
              .filter(([key]) => !percentage || ["auto", "none"].includes(key))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          小數位數
          <select
            aria-label="數值小數位數"
            className={CONTROL}
            value={number.decimals ?? "auto"}
            onChange={(e) =>
              updateNumber({
                decimals:
                  e.target.value === "auto" ? null : Number(e.target.value),
              })
            }
          >
            <option value="auto">自動</option>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} 位
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="千分位分隔"
          value={number.grouping ?? true}
          onChange={(grouping) => updateNumber({ grouping })}
        />
        <Toggle
          label="顯示數值單位"
          value={number.show_unit ?? true}
          onChange={(show_unit) => updateNumber({ show_unit })}
        />
        <p className="text-xs text-muted-foreground">
          僅改變顯示。Tooltip 與逐筆明細保留完整原值；各指標可分別設定。
        </p>
      </fieldset>
      <fieldset className="space-y-2 rounded border p-2">
        <legend className="px-1 text-xs font-medium">
          條件式格式 · {METRICS[metric].label}
        </legend>
        <label className="block space-y-1 text-sm">
          色彩方式
          <select
            aria-label="條件式色彩方式"
            className={CONTROL}
            value={conditional.color_mode ?? "none"}
            onChange={(e) => {
              const color_mode = e.target
                .value as ReportConditionalFormat["color_mode"]
              updateConditional({
                color_mode,
                ...(color_mode === "rules" && !conditional.rules?.length
                  ? {
                      rules: [
                        {
                          minimum: null,
                          maximum: percentage ? 0.5 : 500,
                          color: "#d76857",
                        },
                        {
                          minimum: percentage ? 0.5 : 500,
                          maximum: null,
                          color: "#259688",
                        },
                      ],
                    }
                  : {}),
              })
            }}
          >
            <option value="none">不設定</option>
            <option value="rules">依數值規則</option>
            <option value="gradient">連續色階</option>
          </select>
        </label>
        {table && (conditional.color_mode ?? "none") !== "none" && (
          <label className="block space-y-1 text-sm">
            套用位置
            <select
              aria-label="條件式色彩套用位置"
              className={CONTROL}
              value={conditional.color_target ?? "background"}
              onChange={(e) =>
                updateConditional({
                  color_target: e.target
                    .value as ReportConditionalFormat["color_target"],
                })
              }
            >
              <option value="background">儲存格底色</option>
              <option value="font">數值文字</option>
            </select>
          </label>
        )}
        {conditional.color_mode === "rules" && (
          <>
            <p className="text-xs text-muted-foreground">
              由上往下套用第一條符合規則；下限包含、上限不包含。留空表示不限。
            </p>
            {conditional.rules?.map((rule, index) => (
              <RuleEditor
                key={`${index}-${rule.minimum}-${rule.maximum}`}
                rule={rule}
                index={index}
                percentage={percentage}
                onChange={(next) =>
                  updateConditional({
                    rules: conditional.rules?.map((entry, at) =>
                      at === index ? next : entry
                    ),
                  })
                }
                onRemove={() => {
                  const rules =
                    conditional.rules?.filter((_, at) => at !== index) ?? []
                  updateConditional({
                    rules,
                    ...(!rules.length ? { color_mode: "none" } : {}),
                  })
                }}
              />
            ))}
            <button
              type="button"
              className="min-h-9 text-sm text-primary disabled:opacity-40"
              disabled={(conditional.rules?.length ?? 0) >= 8}
              onClick={() =>
                updateConditional({
                  rules: [
                    ...(conditional.rules ?? []),
                    { minimum: null, maximum: null, color: "#e0a32e" },
                  ],
                })
              }
            >
              新增規則
            </button>
          </>
        )}
        {conditional.color_mode === "gradient" && (
          <>
            <Bounds
              key={`color-${metric}-${conditional.minimum}-${conditional.maximum}`}
              label="色階範圍"
              minimum={conditional.minimum}
              maximum={conditional.maximum}
              percentage={percentage}
              onApply={(minimum, maximum) =>
                updateConditional({ minimum, maximum })
              }
            />
            <ColorInput
              label="低值顏色"
              value={conditional.low_color ?? "#e8edf8"}
              onChange={(low_color) => updateConditional({ low_color })}
            />
            <ColorInput
              label="高值顏色"
              value={conditional.high_color ?? "#2878b5"}
              onChange={(high_color) => updateConditional({ high_color })}
            />
          </>
        )}
        {table && (
          <>
            <Toggle
              label="顯示資料條"
              value={conditional.data_bars ?? false}
              onChange={(data_bars) => updateConditional({ data_bars })}
            />
            {conditional.data_bars && (
              <>
                <Bounds
                  key={`bar-${metric}-${conditional.bar_minimum}-${conditional.bar_maximum}`}
                  label="資料條範圍"
                  minimum={conditional.bar_minimum}
                  maximum={conditional.bar_maximum}
                  percentage={percentage}
                  bars
                  onApply={(bar_minimum, bar_maximum) =>
                    updateConditional({ bar_minimum, bar_maximum })
                  }
                />
                <ColorInput
                  label="正值資料條顏色"
                  value={conditional.positive_color ?? "#259688"}
                  onChange={(positive_color) =>
                    updateConditional({ positive_color })
                  }
                />
                <ColorInput
                  label="負值資料條顏色"
                  value={conditional.negative_color ?? "#d76857"}
                  onChange={(negative_color) =>
                    updateConditional({ negative_color })
                  }
                />
                <Toggle
                  label="資料條顯示數值"
                  value={conditional.show_bar_value ?? true}
                  onChange={(show_bar_value) =>
                    updateConditional({ show_bar_value })
                  }
                />
              </>
            )}
            {card.visual === "matrix" && (
              <Toggle
                label="條件格式套用小計與總計"
                value={conditional.apply_totals ?? false}
                onChange={(apply_totals) => updateConditional({ apply_totals })}
              />
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {card.visual === "matrix"
            ? "自動範圍使用完整最低層分組，換頁與收合不改變刻度。"
            : "自動範圍使用圖表顯示的分組。"}
          空值不著色、不畫資料條。條件式色彩優先於系列配色；折線依各資料點與連線終點著色。
        </p>
        {card.visual === "scatter" && (
          <p className="text-xs text-muted-foreground">
            散佈點先套用主指標規則，未符合時使用第二指標規則。第二指標顏色也套用
            Y 軸標籤。
          </p>
        )}
      </fieldset>
      <fieldset className="space-y-2 rounded border p-2">
        <legend className="px-1 text-xs font-medium">
          {card.visual === "matrix" ? "指標顏色" : "系列／分類顏色"}
        </legend>
        {metrics.map((key, index) => (
          <ColorInput
            key={key}
            label={`${METRICS[key].label}指標顏色`}
            value={
              format.metric_colors?.[key] ??
              reportSeriesColor(card, "primary", index, "none", key)
            }
            onChange={(color) =>
              update({
                metric_colors: { ...format.metric_colors, [key]: color },
              })
            }
          />
        ))}
        {colorItems.map((item, index) => (
          <ColorInput
            key={item.key}
            label={`${item.label}系列顏色`}
            value={reportSeriesColor(card, item.key, index, colorDimension)}
            onChange={(color) =>
              update({
                series_colors: [
                  ...(format.series_colors ?? []).filter(
                    (entry) =>
                      entry.dimension !== colorDimension ||
                      entry.key !== item.key
                  ),
                  {
                    dimension: colorDimension as Exclude<
                      typeof colorDimension,
                      "none"
                    >,
                    key: item.key,
                    color,
                  },
                ].slice(-64),
              })
            }
          />
        ))}
        <button
          type="button"
          className="min-h-9 text-sm text-primary"
          onClick={() => update({ series_colors: [], metric_colors: {} })}
        >
          恢復自動配色
        </button>
        <p className="text-xs text-muted-foreground">
          顏色依分組編號保存，排序或篩選後仍使用相同顏色。
        </p>
      </fieldset>
      {cartesian && (
        <fieldset className="space-y-2 rounded border p-2">
          <legend className="px-1 text-xs font-medium">座標軸</legend>
          {(
            [
              ["show_x", "顯示 X 軸標籤"],
              ["show_y", "顯示 Y 軸標籤"],
              ...(card.visual === "combo"
                ? [["show_secondary", "顯示右側 Y 軸"]]
                : []),
              ["show_grid", "顯示格線"],
              ["show_titles", "顯示軸標題"],
            ] as const
          ).map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              value={
                key === "show_titles"
                  ? (axes.show_titles ?? false)
                  : axes[key as keyof typeof axes] !== false
              }
              onChange={(value) => update({ axes: { ...axes, [key]: value } })}
            />
          ))}
          {axes.show_titles &&
            (
              [
                "x_title",
                "y_title",
                ...(card.visual === "combo" ? ["secondary_title"] : []),
              ] as const
            ).map((key) => (
              <label
                key={key}
                className="block space-y-1 text-sm"
                htmlFor={`${id}-${key}`}
              >
                {key === "x_title"
                  ? "X 軸標題"
                  : key === "y_title"
                    ? "Y 軸標題"
                    : "右側 Y 軸標題"}
                <input
                  id={`${id}-${key}`}
                  aria-label={
                    key === "x_title"
                      ? "X 軸標題"
                      : key === "y_title"
                        ? "Y 軸標題"
                        : "右側 Y 軸標題"
                  }
                  value={(axes[key as keyof typeof axes] as string) ?? ""}
                  maxLength={60}
                  placeholder="使用欄位名稱"
                  className={CONTROL}
                  onChange={(e) =>
                    update({ axes: { ...axes, [key]: e.target.value } })
                  }
                />
              </label>
            ))}
        </fieldset>
      )}
      <fieldset className="space-y-2 rounded border p-2">
        <legend className="px-1 text-xs font-medium">Tooltip</legend>
        <Toggle
          label="顯示 Tooltip"
          value={tooltip.show ?? true}
          onChange={(show) => update({ tooltip: { ...tooltip, show } })}
        />
        {tooltip.show !== false &&
          (
            [
              ["show_rows", "Tooltip 顯示品項／紀錄筆數"],
              ["show_share", "Tooltip 顯示圖中占比"],
              ["show_comparison", "Tooltip 顯示前期與變化"],
              ["show_highlight", "Tooltip 顯示聯動選取"],
              ["show_target", "Tooltip 顯示目標"],
            ] as const
          ).map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              value={tooltip[key] ?? true}
              onChange={(value) =>
                update({ tooltip: { ...tooltip, [key]: value } })
              }
            />
          ))}
        <p className="text-xs text-muted-foreground">
          顯示完整分組路徑、指標名稱與原始單位；關閉 Tooltip
          仍保留鍵盤操作與明細入口。
        </p>
      </fieldset>
    </div>
  )
}
