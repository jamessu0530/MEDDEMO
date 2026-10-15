import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
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
} from "@dnd-kit/sortable"
import { ArrowDown, ArrowUp, MoveDiagonal2 } from "lucide-react"
import {
  desktopReportRects,
  mobileReportCards,
  defaultMobileLayout,
  REPORT_ROW,
  translateDesktopRects,
  resizeDesktopRect,
  alignDesktopRects,
  distributeDesktopRects,
  reorderMobileReport,
  setDesktopReportRects,
  setMobileReportLayout,
  moveMobileReport,
  type DesktopRects,
  type ReportAlignment,
} from "@/lib/report-layout"
import {
  reportPages,
  reorderReportPage,
  type ReportCard,
  type ReportConfig,
} from "@/lib/reports"
import { cn } from "@/lib/utils"
import "./report-layout.css"

const CONTROL =
  "min-h-9 rounded-md border bg-background px-2 text-xs disabled:opacity-40"
export type ReportLayoutRender = {
  fixedHeight?: number
  mobile: boolean
  customMove: boolean
  selected: boolean
  onSelect: (event?: MouseEvent) => void
  moveHandle?: {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
    onPointerCancel: () => void
    onLostPointerCapture: () => void
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  }
}

function ReportLayoutVisual({
  card,
  layout,
  renderCard,
}: {
  card: ReportCard
  layout: ReportLayoutRender
  renderCard: (card: ReportCard, layout: ReportLayoutRender) => ReactNode
}) {
  return renderCard(card, layout)
}

export function ReportLayoutCanvas({
  config,
  pageId,
  editing,
  isDesktop,
  selectedId,
  onSelect,
  onChange,
  renderCard,
  onMobileChange,
}: {
  config: ReportConfig
  pageId: string
  editing: boolean
  isDesktop: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (config: ReportConfig) => void
  onMobileChange: (value: boolean) => void
  renderCard: (card: ReportCard, layout: ReportLayoutRender) => ReactNode
}) {
  const [mobilePreview, setMobilePreview] = useState(false)
  const mobile = !isDesktop || mobilePreview
  useEffect(() => onMobileChange(mobile), [mobile, onMobileChange])
  return (
    <ReportLayoutBoard
      key={`${pageId}/${mobile}`}
      {...{
        config,
        pageId,
        editing,
        isDesktop,
        selectedId,
        onSelect,
        onChange,
        renderCard,
        mobile,
      }}
      onPreviewChange={setMobilePreview}
    />
  )
}

function ReportLayoutBoard({
  config,
  pageId,
  editing,
  isDesktop,
  selectedId,
  onSelect,
  onChange,
  renderCard,
  mobile,
  onPreviewChange,
}: {
  config: ReportConfig
  pageId: string
  editing: boolean
  isDesktop: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (config: ReportConfig) => void
  renderCard: (card: ReportCard, layout: ReportLayoutRender) => ReactNode
  mobile: boolean
  onPreviewChange: (value: boolean) => void
}) {
  const cards = config.cards.filter(
    (card) => (card.page_id ?? "overview") === pageId
  )
  const page = reportPages(config).find((page) => page.id === pageId)!
  const free = !mobile && page.desktop_layout === "free"
  const baseRects = desktopReportRects(cards)
  const [preview, setPreview] = useState<DesktopRects | null>(null)
  const [extraIds, setExtraIds] = useState<string[]>([])
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [announcement, setAnnouncement] = useState("")
  const board = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    id: number
    mode: "move" | "resize"
    cardId: string
    ids: string[]
    startX: number
    startY: number
    startScroll: number
    width: number
    rects: DesktopRects
    latest: DesktopRects
  } | null>(null)
  const rects = preview ?? baseRects
  const selectedIds = [
    ...new Set([
      ...(selectedId && cards.some((card) => card.id === selectedId)
        ? [selectedId]
        : []),
      ...extraIds.filter((id) => cards.some((card) => card.id === id)),
    ]),
  ]
  const selected = new Set(selectedIds)
  const canvasHeight =
    Math.max(24, ...Object.values(rects).map((rect) => rect.y + rect.h)) +
    (editing ? 4 : 0)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const ordered = mobile ? mobileReportCards(cards) : cards
  function cancel() {
    gesture.current = null
    setPreview(null)
  }
  useEffect(() => {
    if (!editing || !free) return
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault()
        cancel()
        setAnnouncement("已取消版面調整")
      }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [editing, free])
  function select(id: string, event?: MouseEvent) {
    if (
      free &&
      event &&
      (event.shiftKey || event.ctrlKey || event.metaKey) &&
      selectedId
    ) {
      if (id !== selectedId)
        setExtraIds((current) =>
          current.includes(id)
            ? current.filter((item) => item !== id)
            : [...current, id]
        )
    } else {
      setExtraIds([])
      onSelect(id)
    }
  }
  function commit(next: DesktopRects) {
    onChange(setDesktopReportRects(config, pageId, next))
    setPreview(null)
  }
  function start(
    event: PointerEvent<HTMLButtonElement>,
    card: ReportCard,
    mode: "move" | "resize"
  ) {
    if (event.button !== 0 || !editing || !free) return
    event.preventDefault()
    const width = board.current?.getBoundingClientRect().width ?? 0
    if (!width) return
    const ids =
      mode === "move" && selected.has(card.id)
        ? [card.id, ...selectedIds.filter((id) => id !== card.id)]
        : [card.id]
    if (!selected.has(card.id)) {
      setExtraIds([])
      onSelect(card.id)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      id: event.pointerId,
      mode,
      cardId: card.id,
      ids,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: window.scrollY,
      width,
      rects: baseRects,
      latest: baseRects,
    }
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    const dx = ((event.clientX - active.startX) * 24) / active.width
    const dy =
      (event.clientY - active.startY + window.scrollY - active.startScroll) /
      REPORT_ROW
    const next =
      active.mode === "move"
        ? translateDesktopRects(active.rects, active.ids, dx, dy, snap)
        : {
            ...active.rects,
            [active.cardId]: resizeDesktopRect(
              active.rects[active.cardId],
              dx,
              dy,
              snap
            ),
          }
    active.latest = next
    setPreview(next)
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    gesture.current = null
    commit(active.latest)
    const rect = active.latest[active.cardId]
    setAnnouncement(
      `位置 ${rect.x}, ${rect.y}；尺寸 ${rect.w} × ${rect.h}，已套用`
    )
  }
  function keyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    card: ReportCard,
    mode: "move" | "resize"
  ) {
    if (
      !editing ||
      !free ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return
    event.preventDefault()
    const step = event.shiftKey ? 5 : snap ? 1 : 0.1
    const dx =
      event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0
    const dy =
      event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0
    const ids = selected.has(card.id)
      ? [card.id, ...selectedIds.filter((id) => id !== card.id)]
      : [card.id]
    const next =
      mode === "move"
        ? translateDesktopRects(baseRects, ids, dx, dy, snap)
        : {
            ...baseRects,
            [card.id]: resizeDesktopRect(baseRects[card.id], dx, dy, snap),
          }
    commit(next)
    setAnnouncement(`已${mode === "move" ? "移動" : "調整尺寸"}：${card.title}`)
  }
  const alignmentLabels: Record<ReportAlignment, string> = {
    left: "靠左",
    center: "水平置中",
    right: "靠右",
    top: "靠上",
    middle: "垂直置中",
    bottom: "靠下",
  }
  return (
    <>
      {editing && (
        <div
          className="mb-3 space-y-3 rounded-lg border bg-card p-3"
          aria-label="報表版面工具"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex rounded-md border p-0.5"
              role="group"
              aria-label="編輯版面裝置"
            >
              <button
                type="button"
                className={cn(
                  CONTROL,
                  "border-0",
                  !mobile && "bg-primary/10 text-primary"
                )}
                aria-pressed={!mobile}
                disabled={!isDesktop}
                onClick={() => onPreviewChange(false)}
              >
                桌機版面
              </button>
              <button
                type="button"
                className={cn(
                  CONTROL,
                  "border-0",
                  mobile && "bg-primary/10 text-primary"
                )}
                aria-pressed={mobile}
                onClick={() => onPreviewChange(true)}
              >
                手機版面
              </button>
            </div>
            {!mobile && (
              <select
                aria-label="桌機版面方式"
                className={CONTROL}
                value={page.desktop_layout ?? "flow"}
                onChange={(event) =>
                  onChange(
                    event.target.value === "free"
                      ? setDesktopReportRects(config, pageId, {})
                      : {
                          ...config,
                          pages: reportPages(config).map((page) =>
                            page.id === pageId
                              ? { ...page, desktop_layout: "flow" }
                              : page
                          ),
                        }
                  )
                }
              >
                <option value="flow">自動格線（原版）</option>
                <option value="free">自由位置與尺寸</option>
              </select>
            )}
            {free && (
              <>
                <label className="flex min-h-9 items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={grid}
                    onChange={(event) => setGrid(event.target.checked)}
                  />
                  顯示格線
                </label>
                <label className="flex min-h-9 items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(event) => setSnap(event.target.checked)}
                  />
                  吸附格線
                </label>
                <button
                  type="button"
                  className={CONTROL}
                  onClick={() => commit(desktopReportRects(cards, true))}
                >
                  自動整理桌機
                </button>
              </>
            )}
          </div>
          {free && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="圖表對齊與分布"
            >
              <span className="mr-1 text-xs text-muted-foreground">
                已選 {selectedIds.length} 張
              </span>
              {(Object.keys(alignmentLabels) as ReportAlignment[]).map(
                (alignment) => (
                  <button
                    key={alignment}
                    type="button"
                    className={CONTROL}
                    disabled={!selectedIds.length}
                    onClick={() =>
                      commit(
                        alignDesktopRects(
                          baseRects,
                          selectedIds,
                          alignment,
                          canvasHeight - (editing ? 4 : 0)
                        )
                      )
                    }
                  >
                    {alignmentLabels[alignment]}
                  </button>
                )
              )}
              <button
                type="button"
                className={CONTROL}
                disabled={selectedIds.length < 3}
                onClick={() =>
                  commit(distributeDesktopRects(baseRects, selectedIds, "x"))
                }
              >
                水平等距
              </button>
              <button
                type="button"
                className={CONTROL}
                disabled={selectedIds.length < 3}
                onClick={() =>
                  commit(distributeDesktopRects(baseRects, selectedIds, "y"))
                }
              >
                垂直等距
              </button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {mobile
              ? "手機順序、尺寸與隱藏狀態獨立儲存。拖曳把手或使用清單的上下移動；隱藏圖表可從清單恢復。"
              : free
                ? "拖曳把手移動、右下角調整尺寸；方向鍵微調，Shift 加速，Esc 取消拖曳。Shift／Ctrl／⌘ 點標題可多選；單張對齊畫布，多張對齊選取範圍。"
                : "原有格線會依寬度自動排列。切換自由位置後，可拖曳、縮放與對齊。"}
          </p>
          <details>
            <summary className="cursor-pointer py-1 text-xs font-medium">
              版面清單（{cards.length} 張）
            </summary>
            <div className="mt-2 space-y-1">
              {(mobile ? mobileReportCards(cards, true) : cards).map(
                (card, index, all) => (
                  <div
                    key={card.id}
                    className="flex min-w-0 flex-wrap items-center gap-1 rounded border p-1.5"
                  >
                    <button
                      type="button"
                      className={cn(
                        "min-h-9 min-w-0 flex-1 truncate rounded px-2 text-left text-xs",
                        selected.has(card.id) && "bg-primary/10 text-primary"
                      )}
                      aria-label={`選取版面圖表：${card.title}`}
                      aria-pressed={selected.has(card.id)}
                      onClick={(event) => select(card.id, event)}
                    >
                      {card.title}
                    </button>
                    {mobile && (
                      <>
                        <button
                          type="button"
                          className={CONTROL}
                          aria-label={`手機上移：${card.title}`}
                          disabled={index === 0}
                          onClick={() =>
                            onChange(moveMobileReport(config, card.id, -1))
                          }
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className={CONTROL}
                          aria-label={`手機下移：${card.title}`}
                          disabled={index === all.length - 1}
                          onClick={() =>
                            onChange(moveMobileReport(config, card.id, 1))
                          }
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                        <label className="flex min-h-9 shrink-0 items-center gap-1 px-1 text-xs">
                          <input
                            type="checkbox"
                            aria-label={`手機顯示：${card.title}`}
                            checked={
                              !defaultMobileLayout(card, cards.indexOf(card))
                                .hidden
                            }
                            onChange={(event) =>
                              onChange(
                                setMobileReportLayout(config, card.id, {
                                  hidden: !event.target.checked,
                                })
                              )
                            }
                          />
                          顯示
                        </label>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </details>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <DndContext
        sensors={sensors}
        onDragEnd={({ active, over }) => {
          if (!editing || free || !over || active.id === over.id) return
          onChange(
            mobile
              ? reorderMobileReport(config, String(active.id), String(over.id))
              : reorderReportPage(config, String(active.id), String(over.id))
          )
        }}
      >
        <SortableContext
          items={ordered.map((card) => card.id)}
          strategy={rectSortingStrategy}
        >
          <div
            ref={board}
            aria-label="報表畫布"
            data-report-layout={
              free ? "desktop-free" : mobile ? "mobile" : "desktop-flow"
            }
            className={cn(
              "min-w-0",
              free ? "relative" : "grid gap-3",
              mobile
                ? "mx-auto w-full max-w-[420px] grid-cols-2"
                : !free && "grid-cols-2 lg:grid-cols-12"
            )}
            style={
              free
                ? {
                    minHeight: canvasHeight * REPORT_ROW,
                    ...(editing && grid
                      ? {
                          backgroundImage:
                            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                          backgroundSize: `${100 / 24}% ${REPORT_ROW}px`,
                        }
                      : {}),
                  }
                : undefined
            }
          >
            {ordered.map((card) => {
              const phone = defaultMobileLayout(card, cards.indexOf(card))
              const rect = rects[card.id]
              const fixedHeight = free
                ? rect.h * REPORT_ROW - 8
                : mobile && card.mobile_layout
                  ? phone.height * REPORT_ROW
                  : undefined
              const style: CSSProperties | undefined = free
                ? {
                    position: "absolute",
                    left: `${(rect.x / 24) * 100}%`,
                    top: rect.y * REPORT_ROW,
                    width: `${(rect.w / 24) * 100}%`,
                    height: rect.h * REPORT_ROW,
                    padding: 4,
                    zIndex:
                      preview && selected.has(card.id)
                        ? 30
                        : selected.has(card.id) && editing
                          ? 20
                          : undefined,
                  }
                : undefined
              return (
                <div
                  key={card.id}
                  className={cn(
                    "min-w-0",
                    free
                      ? "group relative"
                      : mobile &&
                          (phone.width === "half"
                            ? "col-span-1"
                            : "col-span-2"),
                    !free && !mobile && "contents"
                  )}
                  style={style}
                  data-layout-card={card.id}
                  data-layout-rect={
                    free ? `${rect.x},${rect.y},${rect.w},${rect.h}` : undefined
                  }
                >
                  <ReportLayoutVisual
                    card={card}
                    renderCard={renderCard}
                    layout={{
                      fixedHeight,
                      mobile,
                      customMove: free,
                      selected: selected.has(card.id),
                      onSelect: (event) => select(card.id, event),
                      moveHandle:
                        free && editing
                          ? {
                              onPointerDown: (event) =>
                                start(event, card, "move"),
                              onPointerMove: move,
                              onPointerUp: finish,
                              onPointerCancel: cancel,
                              onLostPointerCapture: cancel,
                              onKeyDown: (event) =>
                                keyboard(event, card, "move"),
                            }
                          : undefined,
                    }}
                  />
                  {free && editing && (
                    <button
                      type="button"
                      onPointerDown={(event) => start(event, card, "resize")}
                      onPointerMove={move}
                      onPointerUp={finish}
                      onPointerCancel={cancel}
                      onLostPointerCapture={cancel}
                      onKeyDown={(event) => keyboard(event, card, "resize")}
                      aria-label={`調整尺寸：${card.title}`}
                      title="拖曳或使用方向鍵調整尺寸"
                      className="absolute right-1 bottom-1 z-30 flex size-8 touch-none items-center justify-center rounded-tl-md border border-primary/30 bg-background/95 text-primary focus-visible:outline-2"
                    >
                      <MoveDiagonal2 className="size-4" />
                    </button>
                  )}
                </div>
              )
            })}
            {mobile && !ordered.length && cards.length > 0 && (
              <p className="col-span-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                這一頁的手機版沒有顯示圖表。
                {editing && "可在版面清單勾選顯示。"}
              </p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )
}
