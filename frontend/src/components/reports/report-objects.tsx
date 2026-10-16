import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Eye,
  EyeOff,
  GripVertical,
  LockKeyhole,
  Trash2,
  UnlockKeyhole,
} from "@/components/icons"
import { getDataSource, type DataDetail } from "@/api/report-datasets"
import { DatasetChart } from "@/components/reports/dataset-chart"
import { FieldDropWell } from "@/components/reports/report-fields"
import type { ReportLayoutRender } from "@/components/reports/report-layout"
import { Button } from "@/components/ui/button"
import {
  DIMENSIONS,
  reportPages,
  type ReportConfig,
  type ReportFilterOptions,
} from "@/lib/reports"
import { DATA_AGGREGATIONS, DATA_VISUALS } from "@/lib/report-datasets"
import type {
  StudioAction,
  StudioObject,
  StudioSelections,
} from "@/lib/report-studio"

const INPUT =
  "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-base"
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5 text-sm">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function StudioVisual({
  object,
  editing,
  layout,
  filterOptions,
  values,
  onValues,
  onAction,
}: {
  object: StudioObject
  editing: boolean
  layout: ReportLayoutRender
  filterOptions: ReportFilterOptions
  values: StudioSelections
  onValues: (id: string, keys: string[]) => void
  onAction: (action: StudioAction) => void
}) {
  const selected = object.slicer ? (values[object.id] ?? []) : []
  const options =
    object.slicer && object.slicer.dimension in filterOptions
      ? filterOptions[object.slicer.dimension as keyof ReportFilterOptions]
      : []
  return (
    <article
      data-studio-object={object.id}
      aria-label={object.title}
      onClick={() => {
        if (editing) layout.onSelect()
      }}
      className={`col-span-2 min-w-0 overflow-hidden rounded-lg border bg-card lg:col-span-12 ${layout.selected && editing ? "ring-2 ring-primary" : ""} ${object.hidden && editing ? "opacity-40" : ""}`}
      style={{
        height: layout.fixedHeight ?? (layout.customMove ? "100%" : undefined),
        minHeight: layout.customMove ? undefined : 160,
        background: object.background,
      }}
    >
      {editing && (
        <div className="flex min-h-10 items-center gap-1 border-b bg-muted/30 px-2">
          <button
            type="button"
            aria-label={`拖曳物件：${object.title}`}
            {...layout.moveHandle}
            disabled={object.locked}
            onClick={(event) => {
              event.stopPropagation()
              layout.onSelect(event)
            }}
            className="flex min-h-9 min-w-0 flex-1 touch-none items-center gap-1 text-left text-sm"
          >
            <GripVertical className="size-3.5 shrink-0" />
            <span className="truncate">{object.title}</span>
            {object.locked && <LockKeyhole className="size-3" />}
          </button>
        </div>
      )}
      <div
        className="h-full min-h-0 overflow-auto p-3"
        style={{ maxHeight: editing ? "calc(100% - 40px)" : undefined }}
      >
        {object.kind === "text" && (
          <div
            className="break-words whitespace-pre-wrap"
            style={{ fontSize: object.font_size, color: object.color }}
          >
            {object.text}
          </div>
        )}
        {object.kind === "image" &&
          (object.image ? (
            <img
              src={object.image}
              alt={object.title}
              className="size-full max-h-full object-contain"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              在物件設定上傳圖片。
            </p>
          ))}
        {object.kind === "shape" && (
          <svg
            className="h-full min-h-20 w-full"
            viewBox="0 0 200 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={object.title}
          >
            {object.shape === "ellipse" ? (
              <ellipse cx="100" cy="50" rx="96" ry="46" fill={object.color} />
            ) : object.shape === "line" ? (
              <line
                x1="0"
                y1="50"
                x2="200"
                y2="50"
                stroke={object.color}
                strokeWidth="3"
              />
            ) : (
              <rect
                x="2"
                y="2"
                width="196"
                height="96"
                rx="5"
                fill={object.color}
              />
            )}
          </svg>
        )}
        {object.kind === "button" && (
          <button
            type="button"
            className="min-h-11 w-full rounded-lg px-4 py-3 text-sm font-medium text-white"
            style={{ background: object.color }}
            onClick={(event) => {
              event.stopPropagation()
              if (!editing && object.action) onAction(object.action)
              else layout.onSelect(event)
            }}
          >
            {object.text || object.title}
            {editing && (
              <span className="block text-xs opacity-75">
                切換檢視模式即可執行
              </span>
            )}
          </button>
        )}
        {object.kind === "slicer" && object.slicer && (
          <div className="space-y-2">
            <p className="text-xs font-semibold">
              {object.title} · {DIMENSIONS[object.slicer.dimension]}
            </p>
            {options.length > 0 ? (
              object.slicer.style === "dropdown" ? (
                <select
                  className={INPUT}
                  multiple
                  aria-label={`畫布切片器 ${object.title}`}
                  value={selected}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    onValues(
                      object.id,
                      Array.from(
                        event.target.selectedOptions,
                        (option) => option.value
                      )
                    )
                  }
                >
                  {options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-1">
                  {options.map((option) => (
                    <label
                      key={option.key}
                      className="flex min-h-9 items-center gap-2 text-sm"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(option.key)}
                        onChange={(event) =>
                          onValues(
                            object.id,
                            event.target.checked
                              ? [...selected, option.key]
                              : selected.filter((key) => key !== option.key)
                          )
                        }
                      />
                      <span className="truncate">{option.label}</span>
                    </label>
                  ))}
                </div>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                日期條件請使用報表日期切片器；此畫布元件可改選客戶、商品、業務或類型。
              </p>
            )}
            <button
              className="min-h-9 text-sm text-primary"
              onClick={(event) => {
                event.stopPropagation()
                onValues(object.id, [])
              }}
            >
              清除選取
            </button>
            {object.slicer.sync_group && (
              <p className="text-xs text-muted-foreground">
                同步群組：{object.slicer.sync_group}
              </p>
            )}
          </div>
        )}
        {object.kind === "dataset" && (
          <ImportedVisual key={object.dataset_id} object={object} />
        )}
      </div>
    </article>
  )
}

function ImportedVisual({ object }: { object: StudioObject }) {
  const [source, setSource] = useState<DataDetail | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const abort = new AbortController()
    if (object.dataset_id)
      getDataSource(object.dataset_id, 1, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setSource(value)
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError("這份匯入來源已移除，或不屬於你的帳號。")
        })
    return () => abort.abort()
  }, [object.dataset_id])
  if (error) return <p className="text-xs text-muted-foreground">{error}</p>
  if (!source || !object.dataset_chart)
    return <p className="text-xs text-muted-foreground">正在讀取匯入欄位…</p>
  return <DatasetChart source={source} chart={object.dataset_chart} />
}

export function StudioLayers({
  config,
  pageId,
  selected,
  onSelect,
  onChange,
}: {
  config: ReportConfig
  pageId: string
  selected: string[]
  onSelect: (ids: string[]) => void
  onChange: (config: ReportConfig) => void
}) {
  const items = [...config.cards, ...(config.objects ?? [])]
    .filter((item) => (item.page_id ?? "overview") === pageId)
    .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
  function patch(
    ids: string[],
    value: {
      hidden?: boolean
      locked?: boolean
      layer?: number
      group_id?: string | null
    }
  ) {
    onChange({
      ...config,
      cards: config.cards.map((item) =>
        ids.includes(item.id) ? { ...item, ...value } : item
      ),
      objects: (config.objects ?? []).map((item) =>
        ids.includes(item.id) ? { ...item, ...value } : item
      ),
    })
  }
  function reorder(front: boolean) {
    const sorted = [...items].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
    const chosen = sorted.filter((item) => selected.includes(item.id)),
      rest = sorted.filter((item) => !selected.includes(item.id))
    const ranks = new Map(
      (front ? [...rest, ...chosen] : [...chosen, ...rest]).map(
        (item, index) => [item.id, index]
      )
    )
    onChange({
      ...config,
      cards: config.cards.map((item) =>
        ranks.has(item.id) ? { ...item, layer: ranks.get(item.id) } : item
      ),
      objects: (config.objects ?? []).map((item) =>
        ranks.has(item.id) ? { ...item, layer: ranks.get(item.id)! } : item
      ),
    })
  }
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">選取與圖層</h2>
      <p className="text-xs text-muted-foreground">
        清單由上層到下層排列；鎖定會保護位置與尺寸。
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={selected.length < 2}
          onClick={() =>
            patch(selected, { group_id: `group-${crypto.randomUUID()}` })
          }
        >
          群組
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected.length}
          onClick={() => {
            const groups = items
              .filter((item) => selected.includes(item.id))
              .map((item) => item.group_id)
              .filter(Boolean)
            patch(
              items
                .filter((item) => groups.includes(item.group_id))
                .map((item) => item.id),
              { group_id: null }
            )
          }}
        >
          解除群組
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected.length}
          onClick={() => reorder(true)}
        >
          置頂
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected.length}
          onClick={() => reorder(false)}
        >
          置底
        </Button>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`flex items-center gap-1 rounded border p-1 ${selected.includes(item.id) ? "border-primary bg-primary/5" : ""}`}
        >
          <input
            type="checkbox"
            aria-label={`選取圖層 ${item.title}`}
            checked={selected.includes(item.id)}
            onChange={(event) =>
              onSelect(
                event.target.checked
                  ? [...selected, item.id]
                  : selected.filter((id) => id !== item.id)
              )
            }
          />
          <button
            className="min-h-9 min-w-0 flex-1 truncate text-left text-sm"
            onClick={() => onSelect([item.id])}
          >
            {item.group_id && "▣ "}
            {item.title}
          </button>
          <button
            className="grid size-9 place-items-center"
            aria-label={`${item.hidden ? "顯示" : "隱藏"}圖層 ${item.title}`}
            onClick={() => patch([item.id], { hidden: !item.hidden })}
          >
            {item.hidden ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
          <button
            className="grid size-9 place-items-center"
            aria-label={`${item.locked ? "解除鎖定" : "鎖定"}圖層 ${item.title}`}
            onClick={() => patch([item.id], { locked: !item.locked })}
          >
            {item.locked ? (
              <LockKeyhole className="size-3.5" />
            ) : (
              <UnlockKeyhole className="size-3.5" />
            )}
          </button>
        </div>
      ))}
    </div>
  )
}

export function StudioObjectInspector({
  object,
  config,
  bookmarks,
  onChange,
  onDelete,
}: {
  object: StudioObject
  config: ReportConfig
  bookmarks: { id: string; name: string }[]
  onChange: (object: StudioObject) => void
  onDelete: () => void
}) {
  const [error, setError] = useState("")
  const imageInput = useRef<HTMLInputElement>(null)
  const patch = (value: Partial<StudioObject>) =>
    onChange({ ...object, ...value })
  async function upload(file: File) {
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("請上傳 10MB 內的 PNG、JPEG 或 WebP。")
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement("canvas")
      const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      const context = canvas.getContext("2d")!
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      let image = canvas.toDataURL("image/jpeg", 0.8)
      if (image.length > 300000) image = canvas.toDataURL("image/jpeg", 0.4)
      if (image.length > 300000) throw new Error("圖片仍過大，請縮小後上傳。")
      patch({ image })
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "圖片無法讀取")
    }
  }
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">
        物件設定 ·{" "}
        {
          {
            text: "文字方塊",
            image: "圖片",
            shape: "形狀",
            button: "操作按鈕",
            slicer: "畫布切片器",
            dataset: "匯入圖表",
          }[object.kind]
        }
      </h2>
      <Field label="物件名稱">
        <input
          className={INPUT}
          value={object.title}
          maxLength={80}
          onChange={(event) => patch({ title: event.target.value || "物件" })}
        />
      </Field>
      {["text", "button"].includes(object.kind) && (
        <Field label="顯示文字">
          <textarea
            className={`${INPUT} min-h-24 py-2`}
            value={object.text}
            maxLength={4000}
            onChange={(event) => patch({ text: event.target.value })}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="文字／主色">
          <input
            className={INPUT}
            type="color"
            value={object.color}
            onChange={(event) => patch({ color: event.target.value })}
          />
        </Field>
        <Field label="背景色">
          <input
            className={INPUT}
            type="color"
            value={object.background}
            onChange={(event) => patch({ background: event.target.value })}
          />
        </Field>
      </div>
      {object.kind === "text" && (
        <Field label="文字大小">
          <input
            className={INPUT}
            type="number"
            min={10}
            max={72}
            value={object.font_size}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (value >= 10 && value <= 72) patch({ font_size: value })
            }}
          />
        </Field>
      )}
      {object.kind === "image" && (
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => imageInput.current?.click()}
          >
            上傳圖片
          </Button>
          <input
            className="sr-only"
            aria-label="上傳報表圖片"
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
              event.target.value = ""
            }}
          />
          <p className="text-xs text-muted-foreground">
            圖片隨報表保存與分享，會先縮小並移除照片中繼資料。
          </p>
        </>
      )}
      {object.kind === "shape" && (
        <Field label="形狀">
          <select
            className={INPUT}
            value={object.shape}
            onChange={(event) =>
              patch({ shape: event.target.value as StudioObject["shape"] })
            }
          >
            <option value="rectangle">矩形</option>
            <option value="ellipse">橢圓</option>
            <option value="line">分隔線</option>
          </select>
        </Field>
      )}
      {object.kind === "button" && object.action && (
        <>
          <Field label="按鈕動作">
            <select
              className={INPUT}
              value={object.action.kind}
              onChange={(event) => {
                const kind = event.target.value as StudioAction["kind"]
                patch({
                  action: {
                    kind,
                    target:
                      kind === "page"
                        ? (config.pages?.[0].id ?? "overview")
                        : kind === "bookmark"
                          ? (bookmarks[0]?.id ?? null)
                          : kind === "toggle"
                            ? (config.cards[0]?.id ??
                              config.objects?.find(
                                (item) => item.id !== object.id
                              )?.id ??
                              object.id)
                            : null,
                  },
                })
              }}
            >
              <option value="page">切換分頁</option>
              <option value="bookmark">套用書籤</option>
              <option value="back">返回來源頁</option>
              <option value="reset">清除探索條件</option>
              <option value="toggle">切換物件顯示</option>
            </select>
          </Field>
          {["page", "bookmark", "toggle"].includes(object.action.kind) && (
            <Field label="動作目標">
              <select
                className={INPUT}
                value={object.action.target ?? ""}
                onChange={(event) =>
                  patch({
                    action: {
                      ...object.action!,
                      target: event.target.value || null,
                    },
                  })
                }
              >
                <option value="">選擇目標</option>
                {(object.action.kind === "page"
                  ? reportPages(config)
                  : object.action.kind === "bookmark"
                    ? bookmarks
                    : [...config.cards, ...(config.objects ?? [])]
                        .filter((item) => item.id !== object.id)
                        .map((item) => ({ id: item.id, name: item.title }))
                ).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      {object.kind === "slicer" && object.slicer && (
        <>
          <Field label="切片器欄位">
            <select
              className={INPUT}
              value={object.slicer.dimension}
              onChange={(event) =>
                patch({
                  slicer: {
                    ...object.slicer!,
                    dimension: event.target.value as NonNullable<
                      StudioObject["slicer"]
                    >["dimension"],
                    sync_group: null,
                  },
                })
              }
            >
              {(["customer", "product", "owner", "customer_type"] as const).map(
                (key) => (
                  <option key={key} value={key}>
                    {DIMENSIONS[key]}
                  </option>
                )
              )}
            </select>
          </Field>
          <Field label="呈現方式">
            <select
              className={INPUT}
              value={object.slicer.style}
              onChange={(event) =>
                patch({
                  slicer: {
                    ...object.slicer!,
                    style: event.target.value as "list" | "dropdown",
                  },
                })
              }
            >
              <option value="list">核取清單</option>
              <option value="dropdown">多選清單</option>
            </select>
          </Field>
          <Field label="跨頁同步群組（相同名稱會同步選取）">
            <input
              className={INPUT}
              value={object.slicer.sync_group ?? ""}
              maxLength={48}
              placeholder="例如 customer-filter（英文、數字或連字號）"
              onChange={(event) => {
                const value = event.target.value
                if (!value || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value))
                  patch({
                    slicer: { ...object.slicer!, sync_group: value || null },
                  })
              }}
            />
          </Field>
          <CheckTargets
            title="影響的分頁（未勾選時只影響本頁）"
            items={reportPages(config)}
            selected={object.slicer.pages}
            onChange={(pages) =>
              patch({ slicer: { ...object.slicer!, pages } })
            }
          />
          <CheckTargets
            title="影響的圖表（未勾選時為目標頁全部圖表）"
            items={config.cards.map((card) => ({
              id: card.id,
              name: card.title,
            }))}
            selected={object.slicer.cards}
            onChange={(cards) =>
              patch({ slicer: { ...object.slicer!, cards } })
            }
          />
        </>
      )}
      {object.kind === "dataset" && object.dataset_chart && (
        <ImportedFields
          key={object.dataset_id}
          object={object}
          onChange={onChange}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        className="w-full text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
        刪除物件
      </Button>
    </div>
  )
}

function CheckTargets({
  title,
  items,
  selected,
  onChange,
}: {
  title: string
  items: { id: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <details>
      <summary className="min-h-9 cursor-pointer text-xs">{title}</summary>
      <div className="max-h-40 overflow-y-auto">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex min-h-9 items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id)
                )
              }
            />
            {item.name}
          </label>
        ))}
      </div>
    </details>
  )
}

function ImportedFields({
  object,
  onChange,
}: {
  object: StudioObject
  onChange: (object: StudioObject) => void
}) {
  const [source, setSource] = useState<DataDetail | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    if (object.dataset_id)
      getDataSource(object.dataset_id, 1, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setSource(next)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("無法讀取這份私有來源")
        })
    return () => controller.abort()
  }, [object.dataset_id])
  const chart = object.dataset_chart!
  function patch(value: Partial<typeof chart>) {
    onChange({ ...object, dataset_chart: { ...chart, ...value } })
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">匯入欄位配置</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <FieldDropWell
        label="值"
        value={
          source?.columns.find((column) => column.id === chart.value)?.name ??
          "資料列數"
        }
        role="value"
        onField={(field) => {
          if (
            field.kind === "dataset" &&
            field.dataset_id === object.dataset_id
          ) {
            if (field.column.kind === "number")
              patch({ value: field.column.id, aggregation: "sum" })
            else patch({ value: field.column.id, aggregation: "distinct" })
          } else setError("請使用同一份匯入資料的欄位")
        }}
      />
      <FieldDropWell
        label="分組"
        value={
          source?.columns.find((column) => column.id === chart.group_by)?.name
        }
        role="group"
        onField={(field) => {
          if (
            field.kind === "dataset" &&
            field.dataset_id === object.dataset_id
          )
            patch({ group_by: field.column.id })
          else setError("請使用同一份匯入資料的欄位")
        }}
      />
      {source && (
        <>
          <Field label="分組欄位">
            <select
              className={INPUT}
              value={chart.group_by ?? ""}
              onChange={(event) =>
                patch({ group_by: event.target.value || null })
              }
            >
              <option value="">不分組（數字卡）</option>
              {source.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="數值欄位">
            <select
              className={INPUT}
              value={chart.value ?? ""}
              onChange={(event) => patch({ value: event.target.value || null })}
            >
              <option value="">不指定（資料列數）</option>
              {source.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="計算方式">
        <select
          className={INPUT}
          value={chart.aggregation}
          onChange={(event) =>
            patch({
              aggregation: event.target.value as typeof chart.aggregation,
            })
          }
        >
          {Object.entries(DATA_AGGREGATIONS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="圖表類型">
        <select
          className={INPUT}
          value={chart.visual}
          onChange={(event) =>
            patch({ visual: event.target.value as typeof chart.visual })
          }
        >
          {Object.entries(DATA_VISUALS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}
