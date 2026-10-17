import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react"
import { Database, GripVertical, Plus, Search } from "@/components/icons"
import { listDataSources, type DataSource } from "@/api/report-datasets"
import { DIMENSIONS, METRICS, type ReportCard } from "@/lib/reports"
import {
  FIELD_MIME,
  assignReportField,
  readStudioField,
  type FieldRole,
  type StudioField,
} from "@/lib/report-studio"

const fieldTargets = new WeakMap<Element, (field: StudioField) => void>()

function DraggableField({
  label,
  field,
  onField,
}: {
  label: string
  field: StudioField
  onField: (field: StudioField) => void
}) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const didDrag = useRef(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(FIELD_MIME, JSON.stringify(field))
          event.dataTransfer.setData("text/plain", JSON.stringify(field))
          event.dataTransfer.effectAllowed = "copy"
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.pointerType !== "mouse") return
          event.preventDefault()
          event.currentTarget.focus()
          origin.current = { x: event.clientX, y: event.clientY }
          didDrag.current = false
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!origin.current) return
          if (
            Math.hypot(
              event.clientX - origin.current.x,
              event.clientY - origin.current.y
            ) > 6
          )
            didDrag.current = true
          if (didDrag.current) setGhost({ x: event.clientX, y: event.clientY })
        }}
        onPointerUp={(event) => {
          if (!origin.current) return
          if (didDrag.current) {
            const target = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest("[data-report-field-well]")
            if (target) fieldTargets.get(target)?.(field)
          }
          origin.current = null
          setGhost(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          origin.current = null
          didDrag.current = false
          setGhost(null)
        }}
        onClick={(event) => {
          if (!didDrag.current || event.detail === 0) onField(field)
        }}
        className="flex min-h-9 w-full cursor-grab items-center gap-1.5 rounded px-2 text-left text-sm hover:bg-muted active:cursor-grabbing"
        title={`拖放 ${label}，或點選套用到目前圖表`}
      >
        <GripVertical className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </button>
      {ghost && (
        <div
          className="pointer-events-none fixed z-[100] rounded border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: ghost.x + 10, top: ghost.y + 10 }}
        >
          ＋ {label}
        </div>
      )}
    </>
  )
}

export function ReportDataFields({
  onField,
  onDataset,
}: {
  onField: (field: StudioField, role?: FieldRole) => void
  onDataset: (source: DataSource, field?: StudioField) => void
}) {
  const [search, setSearch] = useState("")
  const [sources, setSources] = useState<DataSource[]>([])
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState("")
  useEffect(() => {
    const abort = new AbortController()
    listDataSources(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setSources(result.datasets)
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("匯入來源暫時無法載入，可從「資料匯入」檢查。")
      })
    return () => abort.abort()
  }, [retry])
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  function field(label: string, value: StudioField) {
    return (
      <DraggableField
        key={`${value.kind}/${value.kind === "dataset" ? value.column.id : value.key}`}
        label={label}
        field={value}
        onField={onField}
      />
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Database className="size-4" />
        資料欄位
      </h2>
      <label className="flex min-h-9 items-center gap-2 rounded border px-2">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          aria-label="搜尋報表欄位"
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋欄位"
        />
      </label>
      <details open>
        <summary className="min-h-9 cursor-pointer text-xs font-medium">
          Σ 業務指標
        </summary>
        {Object.entries(METRICS)
          .filter(([, value]) => matches(value.label))
          .map(([key, value]) =>
            field(value.label, {
              kind: "metric",
              key: key as keyof typeof METRICS,
            })
          )}
      </details>
      <details open>
        <summary className="min-h-9 cursor-pointer text-xs font-medium">
          ▦ 分組與日期
        </summary>
        {Object.entries(DIMENSIONS)
          .filter(([key, label]) => key !== "none" && matches(label))
          .map(([key, label]) =>
            field(label, {
              kind: "dimension",
              key: key as Exclude<keyof typeof DIMENSIONS, "none">,
            })
          )}
      </details>
      <button
        type="button"
        className="min-h-9 text-xs text-primary"
        onClick={() => {
          setError("")
          setRetry((value) => value + 1)
        }}
      >
        重新整理資料表
      </button>
      <details open>
        <summary className="min-h-9 cursor-pointer text-xs font-medium">
          匯入資料表
        </summary>
        {error && <p className="text-xs text-muted-foreground">{error}</p>}
        {sources.map((source) => (
          <details key={source.id} className="border-l pl-2">
            <summary className="min-h-9 cursor-pointer truncate text-xs">
              {source.name}
            </summary>
            <button
              className="flex min-h-9 items-center gap-1 text-sm text-primary"
              onClick={() => onDataset(source)}
            >
              <Plus className="size-3" />
              加入圖表到畫布
            </button>
            {source.columns
              .filter((column) => matches(column.name))
              .map((column) => (
                <div key={column.id}>
                  {field(column.name, {
                    kind: "dataset",
                    dataset_id: source.id,
                    column,
                  })}
                  <button
                    className="sr-only focus:not-sr-only"
                    onClick={() =>
                      onDataset(source, {
                        kind: "dataset",
                        dataset_id: source.id,
                        column,
                      })
                    }
                  >
                    以 {column.name} 新增圖表
                  </button>
                </div>
              ))}
          </details>
        ))}
      </details>
    </div>
  )
}

export function FieldDropWell({
  label,
  value,
  role,
  onField,
}: {
  label: string
  value: ReactNode
  role: FieldRole
  onField: (field: StudioField, role: FieldRole) => void
}) {
  const [over, setOver] = useState(false)
  const targetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = targetRef.current
    if (element) fieldTargets.set(element, (field) => onField(field, role))
    return () => {
      if (element) fieldTargets.delete(element)
    }
  }, [onField, role])
  function drop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const field = readStudioField(
      event.dataTransfer.getData(FIELD_MIME) ||
        event.dataTransfer.getData("text/plain")
    )
    if (field) onField(field, role)
  }
  return (
    <div
      ref={targetRef}
      data-report-field-well={role}
      role="group"
      aria-label={`${label}欄位放置區`}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes(FIELD_MIME) ||
          event.dataTransfer.types.includes("text/plain")
        ) {
          event.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`min-h-14 rounded-md border border-dashed p-2 ${over ? "border-primary bg-primary/10" : "bg-muted/20"}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs font-medium">{value || "將欄位拖到這裡"}</p>
    </div>
  )
}

export function ReportFieldWells({
  card,
  onChange,
  onError,
}: {
  card: ReportCard
  onChange: (card: ReportCard) => void
  onError?: (message: string) => void
}) {
  const [error, setError] = useState("")
  function assign(field: StudioField, role: FieldRole) {
    try {
      onChange(assignReportField(card, field, role))
      setError("")
    } catch (reason) {
      const text =
        reason instanceof Error ? reason.message : "這裡無法使用此欄位"
      setError(text)
      onError?.(text)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium">拖放欄位配置</p>
      <FieldDropWell
        label="值／Y 軸"
        value={METRICS[card.metric].label}
        role="value"
        onField={assign}
      />
      {card.visual !== "kpi" && (
        <FieldDropWell
          label="分組／X 軸"
          value={DIMENSIONS[card.dimension]}
          role="group"
          onField={assign}
        />
      )}
      {[
        "line",
        "area",
        "bar",
        "column",
        "stacked_bar",
        "stacked_column",
        "percent_bar",
        "percent_column",
        "matrix",
      ].includes(card.visual) && (
        <FieldDropWell
          label="圖例"
          value={card.legend && DIMENSIONS[card.legend]}
          role="legend"
          onField={assign}
        />
      )}
      {["combo", "scatter"].includes(card.visual) && (
        <FieldDropWell
          label="第二指標"
          value={card.secondary_metric && METRICS[card.secondary_metric].label}
          role="secondary"
          onField={assign}
        />
      )}
      {card.visual === "matrix" && (
        <div className="grid grid-cols-2 gap-2">
          <FieldDropWell
            label="新增列層級"
            value={card.matrix?.rows.map((key) => DIMENSIONS[key]).join(" → ")}
            role="row"
            onField={assign}
          />
          <FieldDropWell
            label="新增欄層級"
            value={card.matrix?.columns
              .map((key) => DIMENSIONS[key])
              .join(" → ")}
            role="column"
            onField={assign}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
