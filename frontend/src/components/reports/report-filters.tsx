import { SearchSelect } from "@/components/ui/search-select"
import { useId, useState } from "react"
import { X } from "@/components/icons"

import {
  SLICER_DIMENSIONS,
  dateRangeError,
  filterOptionLabel,
  filterSummary,
} from "@/lib/report-filters"
import {
  DIMENSIONS,
  PERIODS,
  type ReportDateRange,
  type ReportFilter,
  type ReportFilterOptions,
  type ReportPeriod,
  type ReportSlicer,
} from "@/lib/reports"

const INPUT = "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"

export function ReportFilterChips({
  options,
  filters = [],
  slicers = [],
  scope,
  onRemoveFilter,
  onRemoveSlicer,
}: {
  options: ReportFilterOptions
  filters?: ReportFilter[]
  slicers?: ReportSlicer[]
  scope?: string
  onRemoveFilter?: (filter: ReportFilter) => void
  onRemoveSlicer?: (slicer: ReportSlicer) => void
}) {
  const items = [
    ...filters.map((filter, index) => ({
      id: `filter-${index}`,
      dimension: filter.dimension,
      keys: [filter.key],
      remove: onRemoveFilter ? () => onRemoveFilter(filter) : undefined,
    })),
    ...slicers.map((slicer) => ({
      id: `slicer-${slicer.dimension}`,
      dimension: slicer.dimension,
      keys: slicer.keys,
      remove: onRemoveSlicer ? () => onRemoveSlicer(slicer) : undefined,
    })),
  ]
  if (!items.length) return null
  return (
    <div
      className="flex min-w-0 flex-wrap gap-1.5"
      aria-label={scope ? `${scope}有效篩選` : "有效篩選"}
    >
      {items.map((item) => {
        const text = `${scope ? `${scope} · ` : ""}${filterSummary(options, item.dimension, item.keys)}`
        const title = `${DIMENSIONS[item.dimension]}：${item.keys.map((key) => filterOptionLabel(options, item.dimension, key)).join("、")}`
        return item.remove ? (
          <button
            key={item.id}
            type="button"
            onClick={item.remove}
            title={title}
            aria-label={`清除${text}`}
            className="flex min-h-9 max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-left text-sm"
          >
            <span className="min-w-0 break-words">{text}</span>
            <X className="size-3 shrink-0" />
          </button>
        ) : (
          <span
            key={item.id}
            title={title}
            className="max-w-full rounded bg-muted px-2 py-1 text-xs break-words"
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

function SlicerField({
  dimension,
  options,
  keys,
  onChange,
}: {
  dimension: (typeof SLICER_DIMENSIONS)[number]
  options: ReportFilterOptions
  keys: string[]
  onChange: (keys: string[]) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {DIMENSIONS[dimension]}
      </p>
      <SearchSelect
        multiple
        label={DIMENSIONS[dimension]}
        value={keys}
        maximum={500}
        placeholder="全部可見資料"
        options={options[dimension].map((option) => ({
          value: option.key,
          label: option.label,
          meta: option.key,
        }))}
        selectedOptions={keys.map((key) => ({
          value: key,
          label: filterOptionLabel(options, dimension, key),
        }))}
        onValueChange={onChange}
      />
    </div>
  )
}

export function ReportSlicerEditor({
  options,
  slicers = [],
  dimensions = SLICER_DIMENSIONS,
  wide = false,
  onChange,
}: {
  options: ReportFilterOptions
  slicers?: ReportSlicer[]
  dimensions?: readonly ReportFilter["dimension"][]
  wide?: boolean
  onChange: (dimension: ReportFilter["dimension"], keys: string[]) => void
}) {
  return (
    <div
      className={
        wide
          ? "grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4"
          : "grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-1"
      }
    >
      {SLICER_DIMENSIONS.filter((dimension) =>
        dimensions.includes(dimension)
      ).map((dimension) => (
        <SlicerField
          key={dimension}
          dimension={dimension}
          options={options}
          keys={
            slicers.find((item) => item.dimension === dimension)?.keys ?? []
          }
          onChange={(keys) => onChange(dimension, keys)}
        />
      ))}
    </div>
  )
}

export function ReportDateRangeEditor({
  value,
  fallback,
  asOf,
  onChange,
  allowClear = false,
  label = "日期範圍",
}: {
  value: ReportDateRange | null
  fallback: ReportDateRange
  asOf?: string
  onChange: (range: ReportDateRange | null) => void
  allowClear?: boolean
  label?: string
}) {
  const id = useId()
  const signature = JSON.stringify(value ?? fallback)
  const [draft, setDraft] = useState({ signature, ...(value ?? fallback) })
  if (signature !== draft.signature)
    setDraft({ signature, ...(value ?? fallback) })
  if (!value && allowClear)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}：沿用報表期間</span>
        <button
          type="button"
          className="min-h-10 rounded-md border px-3 text-primary"
          onClick={() => onChange(fallback)}
        >
          另設日期範圍
        </button>
      </div>
    )
  const error = dateRangeError(draft, asOf)
  const dirty = draft.start !== value?.start || draft.end !== value?.end
  return (
    <fieldset className="min-w-0 space-y-2 rounded-md border p-2">
      <legend className="px-1 text-xs">{label}</legend>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm" htmlFor={`${id}-start`}>
          起始日期
          <input
            id={`${id}-start`}
            aria-label={`${label}起始日期`}
            type="date"
            max={asOf}
            className={INPUT}
            value={draft.start}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value })
            }
          />
        </label>
        <label className="min-w-0 space-y-1 text-sm" htmlFor={`${id}-end`}>
          結束日期
          <input
            id={`${id}-end`}
            aria-label={`${label}結束日期`}
            type="date"
            max={asOf}
            className={INPUT}
            value={draft.end}
            onChange={(event) =>
              setDraft({ ...draft, end: event.target.value })
            }
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-10 rounded-md border px-3 text-sm text-primary disabled:opacity-40"
          disabled={!!error || !dirty}
          onClick={() => onChange({ start: draft.start, end: draft.end })}
        >
          套用日期
        </button>
        {allowClear && (
          <button
            type="button"
            className="min-h-10 px-2 text-sm text-muted-foreground"
            onClick={() => onChange(null)}
          >
            移除日期限制
          </button>
        )}
      </div>
    </fieldset>
  )
}

export function ReportPeriodEditor({
  period,
  range,
  fallback,
  asOf,
  onChange,
}: {
  period: ReportPeriod
  range?: ReportDateRange | null
  fallback: ReportDateRange
  asOf?: string
  onChange: (period: ReportPeriod, range: ReportDateRange | null) => void
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label className="block space-y-1 text-sm">
        報表期間
        <select
          aria-label="報表期間"
          className={INPUT}
          value={period}
          onChange={(event) => {
            const next = event.target.value as ReportPeriod
            onChange(next, next === "custom" ? (range ?? fallback) : null)
          }}
        >
          {Object.entries(PERIODS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {period === "custom" && (
        <ReportDateRangeEditor
          value={range ?? fallback}
          fallback={fallback}
          asOf={asOf}
          label="報表日期"
          onChange={(value) => {
            if (value) onChange("custom", value)
          }}
        />
      )}
    </div>
  )
}
