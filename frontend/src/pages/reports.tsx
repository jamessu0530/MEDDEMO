import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  Download,
  Eye,
  FileChartColumn,
  GripVertical,
  LoaderCircle,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import {
  adjustReport,
  getReportData,
  getReports,
  saveReportConfig,
  type ReportAdjustment,
  type ReportWorkspace,
} from "@/api/reports"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { ReportChart } from "@/components/reports/report-chart"
import {
  ReportInspector,
  ReportVisualGallery,
} from "@/components/reports/report-inspector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { homePath, useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import {
  CUSTOMER_TYPES,
  DIMENSIONS,
  METRICS,
  PERIODS,
  VISUALS,
  moveReportCard,
  normalizeCard,
  normalizeReportConfig,
  reorderReportPage,
  reportCsv,
  reportDataKey,
  reportPages,
  type CardData,
  type OwnerOption,
  type ReportCard,
  type ReportConfig,
  type ReportData,
  type ReportDimension,
  type ReportPeriod,
  type ReportVisual,
} from "@/lib/reports"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

type Boot =
  | { status: "ready"; workspace: ReportWorkspace }
  | { status: "error"; message: string }
type Snapshot =
  | { key: string; status: "ready"; data: ReportData }
  | { key: string; status: "error"; message: string }

export function ReportsPage() {
  const user = useAuth()?.user
  const [boot, setBoot] = useState<Boot | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getReports(controller.signal)
      .then((workspace) => {
        if (!controller.signal.aborted) setBoot({ status: "ready", workspace })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBoot({
            status: "error",
            message:
              error instanceof Error ? error.message : "報表暫時載入不了",
          })
      })
    return () => controller.abort()
  }, [attempt])

  if (!user) return null
  if (boot?.status === "ready")
    return (
      <ReportCanvas
        key={user.id}
        workspace={boot.workspace}
        backTo={homePath(user.role)}
      />
    )
  return (
    <div className="min-h-svh">
      <PageHeader title="我的報表" backTo={homePath(user.role)} />
      <main className="p-4">
        {boot?.status === "error" ? (
          <Notice
            text={boot.message}
            action={{
              label: "重新載入",
              onClick: () => {
                setBoot(null)
                setAttempt((n) => n + 1)
              },
            }}
          />
        ) : (
          <p
            className="py-16 text-center text-sm text-muted-foreground"
            role="status"
          >
            正在準備你的報表…
          </p>
        )}
      </main>
    </div>
  )
}

function ReportCanvas({
  workspace,
  backTo,
}: {
  workspace: ReportWorkspace
  backTo: string
}) {
  const isDesktop = useIsDesktop()
  const [{ config, history }, setDraft] = useState<{
    config: ReportConfig
    history: ReportConfig[]
  }>({ config: workspace.config, history: [] })
  const [savedKey, setSavedKey] = useState(() =>
    JSON.stringify(workspace.config)
  )
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(isDesktop)
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      workspace.config.cards.find((card) => card.visual !== "kpi")?.id ??
      workspace.config.cards[0]?.id ??
      null
  )
  const [pageId, setPageId] = useState(
    () => reportPages(workspace.config)[0].id
  )
  const [mobileInspector, setMobileInspector] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [pageSettings, setPageSettings] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selection, setSelection] = useState<{
    dimension: Exclude<ReportDimension, "none">
    key: string
    label: string
  } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null
  )
  const saveController = useRef<AbortController | null>(null)
  const pages = reportPages(config)
  const currentPage = pages.find((page) => page.id === pageId) ?? pages[0]
  const pageCards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === currentPage.id
  )
  const selected = pageCards.find((card) => card.id === selectedId) ?? null
  const focused = config.cards.find((card) => card.id === focusId)
  const queryConfig = useMemo(
    () => ({
      ...config,
      filters: selection
        ? [
            ...(config.filters ?? []).filter(
              (filter) => filter.dimension !== selection.dimension
            ),
            { dimension: selection.dimension, key: selection.key },
          ]
        : config.filters,
    }),
    [config, selection]
  )
  const queryKey = reportDataKey(queryConfig)
  const dirty = JSON.stringify(config) !== savedKey
  const ready =
    snapshot?.key === queryKey && snapshot.status === "ready"
      ? snapshot.data
      : null
  const error =
    snapshot?.key === queryKey && snapshot.status === "error"
      ? snapshot.message
      : null
  const loading = !ready && !error
  const queryRef = useRef(queryConfig)
  useEffect(() => {
    queryRef.current = queryConfig
  }, [queryConfig])
  useEffect(() => {
    const controller = new AbortController()
    getReportData(queryRef.current, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setSnapshot({ key: queryKey, status: "ready", data })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({
            key: queryKey,
            status: "error",
            message: err instanceof Error ? err.message : "資料暫時載入不了",
          })
      })
    return () => controller.abort()
  }, [queryKey, retry])
  useEffect(() => () => saveController.current?.abort(), [])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function change(next: ReportConfig) {
    const normalized = normalizeReportConfig(next)
    if (
      config.period !== normalized.period ||
      config.owner_id !== normalized.owner_id ||
      config.customer_type !== normalized.customer_type ||
      JSON.stringify(config.filters) !== JSON.stringify(normalized.filters)
    )
      setSelection(null)
    setDraft((current) =>
      JSON.stringify(current.config) === JSON.stringify(normalized)
        ? current
        : {
            config: normalized,
            history: [...current.history, current.config].slice(-30),
          }
    )
    setNotice(null)
  }
  function undo() {
    setSelection(null)
    setDraft((current) => {
      const previous = current.history.at(-1)
      return previous
        ? { config: previous, history: current.history.slice(0, -1) }
        : current
    })
    setNotice(null)
  }
  async function save() {
    const submitted = config
    const controller = new AbortController()
    saveController.current = controller
    setSaving(true)
    setNotice(null)
    try {
      const stored = await saveReportConfig(config, controller.signal)
      if (controller.signal.aborted) return
      setDraft((current) =>
        JSON.stringify(current.config) === JSON.stringify(submitted)
          ? { ...current, config: stored }
          : current
      )
      setSavedKey(JSON.stringify(stored))
      setNotice({ text: "報表已儲存到你的帳號。", error: false })
    } catch (err) {
      if (!controller.signal.aborted)
        setNotice({
          text: err instanceof Error ? err.message : "沒有儲存成功，請再試一次",
          error: true,
        })
    } finally {
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  function selectCard(id: string) {
    setSelectedId(id)
    if (!isDesktop) setMobileInspector(true)
  }
  function updateSelected(patch: Partial<ReportCard>) {
    if (!selected) return
    if (
      patch.page_id &&
      patch.page_id !== currentPage.id &&
      config.cards.filter((card) => card.page_id === patch.page_id).length >= 12
    ) {
      setNotice({ text: "每一頁最多可放 12 個視覺效果。", error: true })
      return
    }
    const next = normalizeCard({ ...selected, ...patch })
    change({
      ...config,
      cards: config.cards.map((card) => (card.id === next.id ? next : card)),
    })
    if (patch.page_id) setPageId(patch.page_id)
  }
  function addVisual(visual: ReportVisual) {
    if (config.cards.length >= 24 || pageCards.length >= 12) return
    const card = normalizeCard({
      id: `visual-${crypto.randomUUID()}`,
      title: `${METRICS.sales.label} · ${VISUALS[visual]}`,
      metric: "sales",
      dimension: "customer",
      visual,
      limit: 5,
      page_id: currentPage.id,
    })
    change({ ...config, cards: [...config.cards, card] })
    setEditing(true)
    setSelectedId(card.id)
    setGallery(false)
    if (!isDesktop) setMobileInspector(true)
  }
  function duplicate() {
    if (!selected || config.cards.length >= 24 || pageCards.length >= 12) return
    const copy = {
      ...selected,
      id: `visual-${crypto.randomUUID()}`,
      title: `${selected.title.slice(0, 35)} 副本`,
    }
    const cards = [...config.cards]
    cards.splice(cards.indexOf(selected) + 1, 0, copy)
    change({ ...config, cards })
    setSelectedId(copy.id)
  }
  function deleteSelected() {
    if (!selected || config.cards.length <= 1) return
    change({
      ...config,
      cards: config.cards.filter((card) => card.id !== selected.id),
    })
    setSelectedId(pageCards.find((card) => card.id !== selected.id)?.id ?? null)
  }
  function addPage() {
    if (pages.length >= 5) return
    const page = {
      id: `page-${crypto.randomUUID()}`,
      name: `第 ${pages.length + 1} 頁`,
    }
    change({ ...config, pages: [...pages, page] })
    setPageId(page.id)
    setSelectedId(null)
  }
  function deletePage() {
    if (pages.length <= 1) return
    const target = pages.find(
      (page) =>
        page.id !== currentPage.id &&
        pageCards.length +
          config.cards.filter(
            (card) => (card.page_id ?? "overview") === page.id
          ).length <=
          12
    )
    if (!target) {
      setNotice({
        text: "其他頁面空間不足，請先移動或刪除部分圖表。",
        error: true,
      })
      return
    }
    change({
      ...config,
      pages: pages.filter((page) => page.id !== currentPage.id),
      cards: config.cards.map((card) =>
        card.page_id === currentPage.id ? { ...card, page_id: target.id } : card
      ),
    })
    setPageId(target.id)
    setPageSettings(false)
  }
  function pointFilter(dimension: ReportDimension, key: string, label: string) {
    if (dimension === "none" || key === "other" || editing) return
    setSelection((current) =>
      current?.dimension === dimension && current.key === key
        ? null
        : { dimension, key, label }
    )
  }
  function download(card: ReportCard) {
    const data = ready?.cards.find((item) => item.id === card.id)
    if (!data) return
    const url = URL.createObjectURL(
      new Blob([reportCsv(card, data)], { type: "text/csv;charset=utf-8" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${card.title.replace(/[^\p{L}\p{N}\s_-]/gu, "_")}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const inspectorProps = {
    card: selected,
    config,
    owners: workspace.owners,
    onChange: updateSelected,
    onAdd: addVisual,
    onDuplicate: duplicate,
    onDelete: deleteSelected,
    onMove: (direction: -1 | 1) => {
      if (selected) change(moveReportCard(config, selected.id, direction))
    },
  }
  const filtered = Boolean(
    config.owner_id || config.customer_type || config.filters?.length
  )
  const focusedData = ready?.cards.find((item) => item.id === focused?.id)

  return (
    <div className="min-h-svh bg-muted/30">
      <PageHeader
        title="報表工作區"
        backTo={backTo}
        trailing={
          <div className="flex items-center gap-1 pr-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="復原上一次調整"
              disabled={!history.length}
              onClick={undo}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              className="h-10 rounded-lg px-3 shadow-none"
              onClick={() => void save()}
              disabled={saving || !dirty}
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              儲存
            </Button>
          </div>
        }
      />
      <div className="border-b bg-card px-3 py-3 lg:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] tracking-widest text-muted-foreground">
              <ChartNoAxesCombined className="size-3.5" />
              我的分析報表
            </p>
            {editing ? (
              <input
                aria-label="報表名稱"
                value={config.name}
                maxLength={40}
                onChange={(event) =>
                  change({ ...config, name: event.target.value || "我的報表" })
                }
                onBlur={(event) => {
                  const name = event.target.value.trim() || "我的報表"
                  if (name !== config.name) change({ ...config, name })
                }}
                className="w-full min-w-0 rounded border border-transparent bg-transparent py-0.5 text-lg font-semibold outline-none focus:border-primary"
              />
            ) : (
              <h2 className="truncate text-lg font-semibold">{config.name}</h2>
            )}
          </div>
          <div
            className="flex shrink-0 items-center gap-1 rounded-lg border bg-muted/50 p-1"
            aria-label="報表模式"
          >
            <button
              type="button"
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs",
                !editing && "bg-card font-medium shadow-sm"
              )}
              aria-pressed={!editing}
              onClick={() => {
                setEditing(false)
                setMobileInspector(false)
              }}
            >
              <Eye className="size-3.5" />
              檢視
            </button>
            <button
              type="button"
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs",
                editing && "bg-card font-medium shadow-sm"
              )}
              aria-pressed={editing}
              onClick={() => {
                setEditing(true)
                if (!isDesktop) setMobileInspector(true)
              }}
            >
              <Pencil className="size-3.5" />
              編輯
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          {editing && (
            <Button
              variant="outline"
              className="h-10 rounded-md border shadow-none"
              disabled={config.cards.length >= 24 || pageCards.length >= 12}
              onClick={() => setGallery(true)}
            >
              <Plus className="size-4" />
              新增視覺效果
            </Button>
          )}
          <Button
            variant={filtersOpen ? "secondary" : "ghost"}
            className="h-10 rounded-md px-3 shadow-none"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="report-filters"
          >
            <SlidersHorizontal className="size-4" />
            切片器
            {filtered && <span className="size-1.5 rounded-full bg-primary" />}
          </Button>
          {editing && (
            <NativeSelect
              aria-label="套用報表範本"
              className="h-10 max-w-36 rounded-md border text-xs shadow-none"
              value=""
              onChange={(event) => {
                if (!event.target.value) return
                change(
                  structuredClone(
                    workspace.templates[
                      event.target.value as "sales" | "manager"
                    ]
                  )
                )
                setPageId("overview")
                setSelectedId(null)
                setSelection(null)
              }}
            >
              <option value="">套用範本</option>
              <option value="sales">業務報表</option>
              <option value="manager">經理報表</option>
            </NativeSelect>
          )}
          <span
            className="ml-auto text-[11px] text-muted-foreground"
            role="status"
          >
            {dirty ? "● 尚未儲存" : "已儲存"}
          </span>
        </div>
        {(filtersOpen || !editing) && (
          <div
            id="report-filters"
            className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 lg:grid-cols-3"
          >
            <label className="space-y-1 text-[11px] text-muted-foreground">
              期間
              <NativeSelect
                aria-label="報表期間"
                className="h-10 rounded-md border shadow-none"
                value={config.period}
                onChange={(event) =>
                  change({
                    ...config,
                    period: event.target.value as ReportPeriod,
                  })
                }
              >
                {Object.entries(PERIODS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              業務
              <NativeSelect
                aria-label="報表業務篩選"
                className="h-10 rounded-md border shadow-none"
                value={config.owner_id ?? ""}
                onChange={(event) =>
                  change({ ...config, owner_id: event.target.value || null })
                }
              >
                <option value="">全部可見業務</option>
                {workspace.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground lg:col-span-1">
              客戶類型
              <NativeSelect
                aria-label="報表客戶類型篩選"
                className="h-10 rounded-md border shadow-none"
                value={config.customer_type ?? ""}
                onChange={(event) =>
                  change({
                    ...config,
                    customer_type: (event.target.value ||
                      null) as ReportConfig["customer_type"],
                  })
                }
              >
                <option value="">全部客戶類型</option>
                {Object.entries(CUSTOMER_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {filtered && (
              <button
                type="button"
                className="min-h-9 text-left text-xs text-primary"
                onClick={() =>
                  change({
                    ...config,
                    owner_id: null,
                    customer_type: null,
                    filters: [],
                  })
                }
              >
                清除報表篩選
              </button>
            )}
          </div>
        )}
        {notice && (
          <p
            role={notice.error ? "alert" : "status"}
            className={cn(
              "mt-3 rounded-md px-3 py-2 text-xs",
              notice.error
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success"
            )}
          >
            {notice.text}
          </p>
        )}
      </div>

      <main
        className={cn(
          "grid min-w-0 pb-[calc(9rem+env(safe-area-inset-bottom))]",
          editing && "lg:grid-cols-[minmax(0,1fr)_18rem]"
        )}
      >
        <div className="min-w-0 p-3 lg:p-5">
          <div
            className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"
            aria-live="polite"
          >
            <span className="flex items-center gap-1.5">
              <FileChartColumn className="size-3.5" />
              {currentPage.name} · {pageCards.length} 個視覺效果
            </span>
            <span>
              {ready
                ? `${PERIODS[config.period]} · ${ready.scope_label} · 截至 ${formatDate(ready.as_of)}`
                : loading
                  ? "正在更新資料…"
                  : "資料載入失敗"}
            </span>
          </div>
          {Boolean(selection || config.filters?.length) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-xs">
              {config.filters?.map((filter) => (
                <span
                  key={filter.dimension}
                  className="rounded bg-muted px-2 py-1"
                >
                  {DIMENSIONS[filter.dimension]}：{filter.key}
                </span>
              ))}
              {selection && (
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="flex min-h-8 items-center gap-2 rounded bg-primary/10 px-2 text-primary"
                >
                  聯動篩選 · {selection.label}
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
          {error && (
            <Notice
              text={error}
              action={{
                label: "再試一次",
                onClick: () => {
                  setSnapshot(null)
                  setRetry((n) => n + 1)
                },
              }}
            />
          )}
          {editing && (
            <p className="mb-3 text-[11px] text-muted-foreground">
              選取圖表以配置欄位與格式，拖曳把手調整順序。
              <span className="lg:hidden">點選標題開啟設定。</span>
            </p>
          )}
          <DndContext
            sensors={sensors}
            onDragEnd={({ active, over }) => {
              if (over && active.id !== over.id)
                change(
                  reorderReportPage(config, String(active.id), String(over.id))
                )
            }}
          >
            <SortableContext
              items={pageCards.map((card) => card.id)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid grid-cols-2 gap-3 lg:grid-cols-12"
                aria-label="報表畫布"
                aria-busy={loading}
              >
                {pageCards.map((card) => (
                  <CanvasVisual
                    key={card.id}
                    card={card}
                    data={ready?.cards.find((item) => item.id === card.id)}
                    kpiCount={
                      pageCards.filter((item) => item.visual === "kpi").length
                    }
                    editing={editing}
                    selected={card.id === selected?.id}
                    loading={loading}
                    selectedKey={
                      selection?.dimension === card.dimension
                        ? selection.key
                        : undefined
                    }
                    onSelect={() => selectCard(card.id)}
                    onFocus={() => setFocusId(card.id)}
                    onPoint={pointFilter}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {!pageCards.length && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card/50 text-center">
              <FileChartColumn className="size-9 text-muted-foreground/50" />
              <p className="text-sm font-medium">這一頁還沒有視覺效果</p>
              <p className="px-5 text-xs text-muted-foreground">
                選擇圖表，再配置你想比較的資料。
              </p>
              <Button
                className="rounded-md shadow-none"
                onClick={() => setGallery(true)}
              >
                <Plus className="size-4" />
                新增視覺效果
              </Button>
            </div>
          )}
          <div
            className="mt-4 flex items-center overflow-x-auto border-t border-b bg-card"
            aria-label="報表分頁"
          >
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                aria-current={page.id === currentPage.id ? "page" : undefined}
                onClick={() => {
                  setPageId(page.id)
                  setSelectedId(null)
                  setSelection(null)
                }}
                className={cn(
                  "min-h-11 shrink-0 border-t-2 border-transparent px-4 text-xs",
                  page.id === currentPage.id
                    ? "border-t-amber-400 bg-amber-50 font-semibold text-slate-800 dark:bg-amber-400/10 dark:text-amber-100"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {page.name}
              </button>
            ))}
            {editing && (
              <>
                <button
                  type="button"
                  aria-label="新增報表分頁"
                  disabled={pages.length >= 5}
                  onClick={addPage}
                  className="flex size-11 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-30"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="報表分頁設定"
                  onClick={() => setPageSettings(true)}
                  className="ml-auto flex size-11 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <Settings2 className="size-4" />
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {editing
              ? "最多 5 頁，每頁 12 個視覺效果。"
              : "點選圖表上的資料即可聯動篩選，再點一次取消。"}{" "}
            · 金額以新台幣計
          </p>
        </div>
        {editing && isDesktop && (
          <aside
            aria-label="視覺效果設定面板"
            className="sticky top-16 max-h-[calc(100dvh-5rem)] self-start overflow-y-auto border-l bg-card p-3 pb-24"
          >
            <ReportInspector {...inspectorProps} />
          </aside>
        )}
      </main>
      <Dialog
        open={editing && mobileInspector && !isDesktop}
        onOpenChange={setMobileInspector}
      >
        <DialogContent
          showCloseButton={false}
          className="inset-x-0 top-auto bottom-0 grid max-h-[88dvh] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-t-2xl rounded-b-none border p-0 shadow-xl"
        >
          <DialogHeader className="flex-row items-center justify-between border-b px-4 py-2">
            <div>
              <DialogTitle className="text-sm">編輯圖表</DialogTitle>
              <DialogDescription className="text-xs">
                {selected
                  ? `正在編輯：${selected.title}`
                  : "選擇圖表建立你的報表"}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              className="size-11"
              aria-label="關閉視覺效果設定"
              onClick={() => setMobileInspector(false)}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>
          <div className="overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <ReportInspector {...inspectorProps} hideHeading />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={gallery} onOpenChange={setGallery}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-xl border p-4 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增視覺效果</DialogTitle>
            <DialogDescription>
              16 種呈現方式，選擇後可再配置資料與格式。
            </DialogDescription>
          </DialogHeader>
          <ReportVisualGallery onSelect={addVisual} />
        </DialogContent>
      </Dialog>
      <Dialog open={pageSettings} onOpenChange={setPageSettings}>
        <DialogContent className="rounded-xl border shadow-xl">
          <DialogHeader>
            <DialogTitle>分頁設定</DialogTitle>
            <DialogDescription>
              替目前分頁命名，或把圖表移至其他頁。
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-xs">
            分頁名稱
            <input
              aria-label="分頁名稱"
              maxLength={40}
              className="h-11 w-full rounded-md border bg-card px-3 text-base"
              value={currentPage.name}
              onBlur={(event) => {
                const name = event.target.value.trim() || "未命名"
                if (name !== currentPage.name)
                  change({
                    ...config,
                    pages: pages.map((page) =>
                      page.id === currentPage.id ? { ...page, name } : page
                    ),
                  })
              }}
              onChange={(event) =>
                change({
                  ...config,
                  pages: pages.map((page) =>
                    page.id === currentPage.id
                      ? { ...page, name: event.target.value || "未命名" }
                      : page
                  ),
                })
              }
            />
          </label>
          <Button
            variant="outline"
            disabled={pages.length <= 1}
            className="rounded-md text-destructive shadow-none"
            onClick={deletePage}
          >
            <Trash2 className="size-4" />
            移除分頁，圖表移至其他頁
          </Button>
          <Button
            className="rounded-md shadow-none"
            onClick={() => setPageSettings(false)}
          >
            完成
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(focused)}
        onOpenChange={(open) => {
          if (!open) setFocusId(null)
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-xl border shadow-xl sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{focused?.title}</DialogTitle>
            <DialogDescription>放大檢視 · 精確數值與明細</DialogDescription>
          </DialogHeader>
          {focused && focusedData ? (
            <ReportChart
              card={focused}
              data={focusedData}
              expanded
              onSelectPoint={editing ? undefined : pointFilter}
              selectedKey={
                selection?.dimension === focused.dimension
                  ? selection.key
                  : undefined
              }
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              正在載入資料…
            </p>
          )}
          {focused && (
            <Button
              variant="outline"
              className="rounded-md shadow-none"
              disabled={!focusedData}
              onClick={() => download(focused)}
            >
              <Download className="size-4" />
              匯出目前資料 CSV
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <AiReportDock
        config={config}
        owners={workspace.owners}
        available={workspace.ai_available}
        onApply={change}
      />
    </div>
  )
}

function CanvasVisual({
  card,
  data,
  kpiCount,
  editing,
  selected,
  loading,
  selectedKey,
  onSelect,
  onFocus,
  onPoint,
}: {
  card: ReportCard
  data?: CardData
  kpiCount: number
  editing: boolean
  selected: boolean
  loading: boolean
  selectedKey?: string
  onSelect: () => void
  onFocus: () => void
  onPoint: (dimension: ReportDimension, key: string, label: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !editing })
  const kpiSpan =
    kpiCount <= 2
      ? "col-span-1 lg:col-span-6"
      : kpiCount === 3
        ? "col-span-1 lg:col-span-4"
        : editing
          ? "col-span-1 lg:col-span-6 2xl:col-span-3"
          : "col-span-1 lg:col-span-3"
  const span =
    card.width === "full"
      ? "col-span-2 lg:col-span-12"
      : card.visual === "kpi"
        ? kpiSpan
        : editing
          ? "col-span-2 lg:col-span-12 2xl:col-span-6"
          : "col-span-2 lg:col-span-6"
  const tableHeight =
    card.height === "compact" ? 160 : card.height === "tall" ? 360 : 240
  const valueHeight =
    card.height === "compact" ? 64 : card.height === "tall" ? 180 : 96
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "min-w-0 self-start overflow-hidden rounded-lg border bg-card p-3 shadow-sm lg:p-4",
        span,
        editing && selected
          ? "border-amber-400 ring-1 ring-amber-400"
          : "border-border",
        isDragging && "z-20 opacity-80 shadow-xl"
      )}
      aria-label={card.title}
    >
      <div className="mb-3 flex items-start gap-1.5">
        {editing && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            aria-label={`拖曳排序：${card.title}`}
            className="-mt-2 -ml-2 flex size-9 shrink-0 touch-none items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className="min-h-6 w-full text-left text-sm leading-snug font-semibold wrap-break-word"
            >
              {card.title}
            </button>
          ) : (
            <h3 className="text-sm leading-snug font-semibold wrap-break-word">
              {card.title}
            </h3>
          )}
          {card.visual !== "kpi" && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {METRICS[card.metric].label} · {DIMENSIONS[card.dimension]}
              {card.legend ? ` / ${DIMENSIONS[card.legend]}` : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          className="-mt-2 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-label={`放大檢視：${card.title}`}
          onClick={onFocus}
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      <div
        className="min-w-0 overflow-auto"
        style={
          card.visual === "kpi"
            ? { minHeight: valueHeight }
            : card.visual === "table" || card.visual === "matrix"
              ? { height: tableHeight }
              : undefined
        }
      >
        {data ? (
          <ReportChart
            card={card}
            data={data}
            onSelectPoint={editing ? undefined : onPoint}
            selectedKey={selectedKey}
          />
        ) : (
          <div
            className={cn(
              "rounded-md bg-muted/60",
              card.visual === "kpi" ? "h-16" : "h-48",
              loading && "motion-safe:animate-pulse"
            )}
            aria-label={loading ? "載入中" : "資料未載入"}
          />
        )}
      </div>
      {data?.note && (
        <p className="mt-3 border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
          {data.note}
        </p>
      )}
    </article>
  )
}

const SUGGESTIONS = [
  "新增客戶類型的業績環圈圖",
  "把每月銷售改成按客戶類型堆疊直條圖",
  "新增一頁經理看的業績與淨毛利分析",
]

/** visualViewport 在手機鍵盤打開時縮小，輸入膠囊跟著移到鍵盤上方。 */
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () =>
      setInset(
        Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      )
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    update()
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])
  return inset
}

function AiReportDock({
  config,
  owners,
  available,
  onApply,
}: {
  config: ReportConfig
  owners: OwnerOption[]
  available: boolean
  onApply: (config: ReportConfig) => void
}) {
  const [question, setQuestion] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    adjustment: ReportAdjustment
    base: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latestConfig = useRef(config)
  const controllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyboardInset = useKeyboardInset()
  const configKey = JSON.stringify(config)
  const activeResult = result?.base === configKey ? result.adjustment : null
  useEffect(() => {
    latestConfig.current = config
  }, [config])
  useEffect(() => () => controllerRef.current?.abort(), [])

  async function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy || !available) return
    const baseConfig = latestConfig.current
    const base = JSON.stringify(baseConfig)
    const controller = new AbortController()
    controllerRef.current = controller
    setQuestion(trimmed)
    setBusy(true)
    setExpanded(false)
    setError(null)
    setResult(null)
    inputRef.current?.blur()
    try {
      const adjustment = await adjustReport(
        trimmed,
        baseConfig,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (JSON.stringify(latestConfig.current) !== base) {
        setError("報表在 AI 調整時改過了，請依目前的報表再送一次。")
        return
      }
      setResult({ adjustment, base })
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : "AI 這次沒有完成調整，請再試一次"
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void ask(question)
  }

  function apply() {
    if (!activeResult?.config) return
    onApply(activeResult.config)
    setResult(null)
    setQuestion("")
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 mx-auto max-w-md px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:left-56 lg:max-w-3xl lg:px-6"
      style={{ bottom: keyboardInset }}
    >
      <div className="pointer-events-auto">
        {(expanded || activeResult || error) && (
          <div className="mb-3 max-h-[min(55dvh,28rem)] overflow-y-auto rounded-3xl border-2 bg-card p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary" />
                {activeResult?.kind === "proposal"
                  ? "AI 建議的調整"
                  : "用一句話調整報表"}
              </p>
              <button
                type="button"
                aria-label="收起 AI 調整"
                className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                onClick={() => {
                  setExpanded(false)
                  setResult(null)
                  setError(null)
                }}
              >
                <X className="size-4" />
              </button>
            </div>
            {error && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {activeResult ? (
              <div aria-live="polite">
                <p className="text-sm leading-relaxed">
                  {activeResult.message}
                </p>
                {activeResult.config && (
                  <>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {PERIODS[activeResult.config.period]} ·{" "}
                      {activeResult.config.owner_id
                        ? (owners.find(
                            (owner) =>
                              owner.id === activeResult.config?.owner_id
                          )?.name ?? "已選業務")
                        : "全部可見業務"}{" "}
                      ·{" "}
                      {activeResult.config.customer_type
                        ? CUSTOMER_TYPES[activeResult.config.customer_type]
                        : "全部客戶類型"}
                    </p>
                    <ol className="my-3 space-y-1.5 rounded-2xl bg-muted/60 p-3">
                      {activeResult.config.cards.map((card, index) => (
                        <li
                          key={card.id}
                          className="flex items-start gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {index + 1}.
                          </span>
                          <span className="min-w-0 flex-1 wrap-break-word">
                            {card.title}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {VISUALS[card.visual]}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="mb-3 text-xs text-muted-foreground">
                      套用後可復原，按儲存即可保留到帳號。
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="h-11 flex-1 rounded-full"
                        onClick={apply}
                      >
                        <Check className="size-4" />
                        套用調整
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 rounded-full"
                        onClick={() => setResult(null)}
                      >
                        保留原版
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              expanded && (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    {available
                      ? "告訴 AI 你想看哪些數字、圖表與順序，它會先給你預覽。"
                      : "AI 尚未設定。你仍可用「自訂」選擇卡片、圖表與順序。"}
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((text) => (
                      <button
                        key={text}
                        type="button"
                        disabled={!available || busy}
                        onClick={() => void ask(text)}
                        className="min-h-11 rounded-xl bg-muted/60 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex min-h-16 items-center gap-1 rounded-full border-2 border-primary/20 bg-card px-2 shadow-xl shadow-primary/10 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
        >
          <button
            type="button"
            aria-label="開啟 AI 調整建議"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Sparkles className="size-5" />
          </button>
          <input
            ref={inputRef}
            value={question}
            maxLength={600}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy || !available}
            aria-label="用自然語言調整報表"
            placeholder={
              busy
                ? "AI 正在調整…"
                : available
                  ? "想看什麼？告訴 AI…"
                  : "AI 尚未設定，先試試自訂"
            }
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground disabled:opacity-70"
          />
          <button
            type="submit"
            aria-label="送出報表調整需求"
            disabled={busy || !available || !question.trim()}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {busy ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </button>
        </form>
        <p
          role="status"
          className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground"
        >
          {busy
            ? "正在理解你的需求，原報表保留中…"
            : "AI 幫你調整重點，報表由你決定"}
        </p>
      </div>
    </div>
  )
}
