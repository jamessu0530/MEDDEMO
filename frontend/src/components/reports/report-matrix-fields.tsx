import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { NativeSelect } from "@/components/ui/native-select"
import {
  DIMENSIONS,
  METRICS,
  SALES_METRICS,
  reportMatrixOptions,
  validDimensions,
  type ReportCard,
  type ReportFilter,
  type ReportMatrixOptions,
} from "@/lib/reports"

export function ReportMatrixFields({
  card,
  onChange,
}: {
  card: ReportCard
  onChange: (patch: Partial<ReportCard>) => void
}) {
  const options = reportMatrixOptions(card)
  const dimensions = validDimensions(card.metric).filter(
    (dimension): dimension is ReportFilter["dimension"] => dimension !== "none"
  )
  const metrics = SALES_METRICS.includes(card.metric)
    ? SALES_METRICS
    : [card.metric]
  function update(patch: Partial<ReportMatrixOptions>) {
    const matrix = { ...options, ...patch }
    onChange({
      matrix,
      dimension: matrix.rows[0],
      legend: matrix.columns[0] ?? null,
      metric: matrix.metrics[0],
    })
  }
  return (
    <div className="space-y-3 rounded-md border p-2">
      {(["rows", "columns"] as const).map((axis) => {
        const name = axis === "rows" ? "列" : "欄"
        const used = [...options.rows, ...options.columns]
        const available = dimensions.filter(
          (dimension) => !used.includes(dimension)
        )
        return (
          <div key={axis} className="space-y-2">
            <p className="text-xs font-medium">{name}階層</p>
            {options[axis].map((dimension, index) => (
              <div key={index} className="flex min-w-0 items-center gap-1">
                <NativeSelect
                  aria-label={`${name}階層 ${index + 1}`}
                  value={dimension}
                  className="h-10 flex-1 rounded-md border text-xs shadow-none"
                  onChange={(event) =>
                    update({
                      [axis]: options[axis].map((entry, at) =>
                        at === index
                          ? (event.target.value as ReportFilter["dimension"])
                          : entry
                      ),
                    })
                  }
                >
                  {[dimension, ...available].map((choice) => (
                    <option key={choice} value={choice}>
                      {DIMENSIONS[choice]}
                    </option>
                  ))}
                </NativeSelect>
                {[-1, 1].map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
                    aria-label={`${name}階層 ${index + 1}${direction < 0 ? "上移" : "下移"}`}
                    disabled={
                      index + direction < 0 ||
                      index + direction >= options[axis].length
                    }
                    onClick={() => {
                      const next = [...options[axis]]
                      ;[next[index], next[index + direction]] = [
                        next[index + direction],
                        next[index],
                      ]
                      update({ [axis]: next })
                    }}
                  >
                    {direction < 0 ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={`移除${name}階層 ${index + 1}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground disabled:opacity-30"
                  disabled={axis === "rows" && options.rows.length === 1}
                  onClick={() =>
                    update({
                      [axis]: options[axis].filter((_, at) => at !== index),
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="flex min-h-9 items-center gap-1 text-xs text-primary disabled:opacity-40"
              disabled={!available.length || options[axis].length >= 3}
              onClick={() =>
                update({ [axis]: [...options[axis], available[0]] })
              }
            >
              <Plus className="size-3" />
              新增{name}階層
            </button>
          </div>
        )
      })}
      <fieldset className="space-y-2 border-t pt-2">
        <legend className="pt-2 text-xs font-medium">
          矩陣指標（相同資料來源）
        </legend>
        {metrics.map((metric) => (
          <label
            key={metric}
            className="flex min-h-9 items-center gap-2 text-xs"
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={options.metrics.includes(metric)}
              disabled={
                options.metrics.length === 1 && options.metrics[0] === metric
              }
              onChange={(event) =>
                update({
                  metrics: event.target.checked
                    ? [...options.metrics, metric]
                    : options.metrics.filter((entry) => entry !== metric),
                })
              }
            />
            {METRICS[metric].label}
          </label>
        ))}
      </fieldset>
      {(["show_subtotals", "show_grand_total"] as const).map((key) => (
        <label key={key} className="flex min-h-9 items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={options[key]}
            onChange={(event) => update({ [key]: event.target.checked })}
          />
          {key === "show_subtotals" ? "顯示階層小計" : "顯示總計"}
        </label>
      ))}
      {(["row_expand_depth", "column_expand_depth"] as const).map((key) => (
        <label key={key} className="block space-y-1 text-xs">
          {key.startsWith("row") ? "預設列展開層數" : "預設欄展開層數"}
          <NativeSelect
            aria-label={
              key.startsWith("row") ? "預設列展開層數" : "預設欄展開層數"
            }
            value={options[key]}
            className="h-10 rounded-md border text-xs shadow-none"
            onChange={(event) => update({ [key]: Number(event.target.value) })}
          >
            {[1, 2, 3].map((depth) => (
              <option key={depth} value={depth}>
                {depth} 層
              </option>
            ))}
          </NativeSelect>
        </label>
      ))}
      <p className="text-[11px] text-muted-foreground">
        每個軸最多三層；小計與總計直接聚合資料，畫面可展開與分頁。客戶及應收為目前快照。
      </p>
    </div>
  )
}
