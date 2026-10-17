import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import { ReportWidgetResizeHandle } from "@/components/reports/report-widget"
import {
  automaticReportRects,
  automaticReportSizes,
  resizeAutomaticReportCard,
  setAutomaticReportSize,
  setAutomaticReportPreset,
  type ReportCardSize,
} from "@/lib/report-auto-layout"
import { REPORT_COLUMNS, REPORT_ROW } from "@/lib/report-layout"
import {
  REPORT_WIDGET_PRESETS,
  type ReportWidgetSize,
} from "@/lib/report-widget"
import {
  reorderReportPage,
  type ReportCard,
  type ReportConfig,
} from "@/lib/reports"
import "./report-layout.css"

// Pointer sorting follows the finger; keyboard sorting aligns card origins so
// a large card can move over a small card without colliding with itself.
const automaticCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args)
    return hits.length ? hits : closestCenter(args)
  }
  return args.droppableContainers
    .flatMap((container) => {
      const rect = args.droppableRects.get(container.id)
      return rect
        ? [
            {
              id: container.id,
              data: {
                droppableContainer: container,
                value: Math.hypot(
                  rect.left - args.collisionRect.left,
                  rect.top - args.collisionRect.top
                ),
              },
            },
          ]
        : []
    })
    .sort((a, b) => a.data.value - b.data.value)
}

export type ReportLayoutRender = {
  fixedHeight: number
  selected: boolean
  draggable: boolean
  onSelect: (event?: MouseEvent) => void
  onSize?: (size: ReportWidgetSize) => void
}
type Props = {
  config: ReportConfig
  pageId: string
  editing: boolean
  readonly?: boolean
  isDesktop: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (config: ReportConfig) => void
  selectionIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  renderCard: (card: ReportCard, layout: ReportLayoutRender) => ReactNode
}

export function ReportLayoutCanvas(props: Props) {
  return (
    <ReportLayoutBoard key={`${props.pageId}/${props.isDesktop}`} {...props} />
  )
}

function ReportLayoutBoard({
  config,
  pageId,
  editing,
  readonly = false,
  isDesktop,
  selectedId,
  onSelect,
  onChange,
  selectionIds,
  onSelectionChange,
  renderCard,
}: Props) {
  const [compact, setCompact] = useState(!isDesktop)
  const cards = config.cards.filter(
    (card) =>
      (card.page_id ?? "overview") === pageId && (editing || !card.hidden)
  )
  const baseSizes = automaticReportSizes(cards)
  const [resizingId, setResizingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const rects = automaticReportRects(cards, compact, baseSizes)
  const board = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = board.current
    if (!element) return
    const measure = () => setCompact(element.clientWidth < 560)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const gesture = useRef<{
    pointer: number
    cardId: string
    x: number
    y: number
    scroll: number
    width: number
    element: HTMLElement
    bounds: { width: number; height: number }
    preview: { width: number; height: number }
    initial: ReportCardSize
    latest: ReportCardSize
  } | null>(null)
  const previewFrame = useRef<number | null>(null)
  const selected = new Set(
    selectionIds?.length ? selectionIds : selectedId ? [selectedId] : []
  )
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { delay: 350, tolerance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 450, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const cancel = useCallback(() => {
    if (previewFrame.current !== null)
      cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null
    const element = gesture.current?.element
    element?.style.removeProperty("transform")
    element?.style.removeProperty("transform-origin")
    element?.style.removeProperty("will-change")
    gesture.current = null
    setResizingId(null)
  }, [])
  useEffect(() => cancel, [editing, readonly, config, compact, cancel])
  useEffect(() => {
    if (readonly) return
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return
      event.preventDefault()
      cancel()
      setAnnouncement("已取消大小調整")
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [readonly, cancel])
  function select(card: ReportCard, event?: MouseEvent) {
    const members = card.group_id
      ? cards
          .filter((item) => item.group_id === card.group_id)
          .map((item) => item.id)
      : [card.id]
    const multiple = event && (event.shiftKey || event.ctrlKey || event.metaKey)
    const next = multiple
      ? selected.has(card.id)
        ? [...selected].filter((id) => !members.includes(id))
        : [...new Set([...selected, ...members])]
      : members
    onSelectionChange?.(next)
    onSelect(next.includes(card.id) ? card.id : (next[0] ?? ""))
  }
  function start(event: PointerEvent<HTMLButtonElement>, card: ReportCard) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      gesture.current ||
      readonly ||
      card.locked
    )
      return
    const width = board.current?.clientWidth ?? 0
    const element = event.currentTarget.parentElement
    if (!width || !element) return
    const { width: cardWidth, height: cardHeight } =
      element.getBoundingClientRect()
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      pointer: event.pointerId,
      cardId: card.id,
      x: event.clientX,
      y: event.clientY,
      scroll: window.scrollY,
      width,
      element,
      bounds: { width: cardWidth, height: cardHeight },
      preview: { width: cardWidth, height: cardHeight },
      initial: baseSizes[card.id],
      latest: baseSizes[card.id],
    }
    element.style.transformOrigin = "top left"
    element.style.willChange = "transform"
    setResizingId(card.id)
  }
  function update(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y + window.scrollY - active.scroll
    active.latest = resizeAutomaticReportCard(
      active.initial,
      dx,
      dy,
      active.width,
      compact
    )
    active.preview = {
      width: Math.max(
        active.width * (compact ? 0.5 : 4 / REPORT_COLUMNS),
        Math.min(active.width, active.bounds.width + dx)
      ),
      height: Math.max(
        8 * REPORT_ROW,
        Math.min(60 * REPORT_ROW, active.bounds.height + dy)
      ),
    }
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    update(event)
    if (!gesture.current || previewFrame.current !== null) return
    // Composite the existing card once per frame. Its chart, ResizeObservers
    // and neighbouring grid cells keep their committed dimensions until drop.
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null
      const active = gesture.current
      if (!active) return
      active.element.style.transform = `scale(${active.preview.width / active.bounds.width}, ${active.preview.height / active.bounds.height})`
    })
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    update(event)
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    if (
      active.initial.w !== active.latest.w ||
      active.initial.h !== active.latest.h
    )
      onChange(setAutomaticReportSize(config, active.cardId, active.latest))
    cancel()
    setAnnouncement("已調整卡片大小並自動整理版面")
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, card: ReportCard) {
    if (
      readonly ||
      card.locked ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const width = board.current?.clientWidth ?? 0
    const step = event.shiftKey ? 5 : 1
    const horizontal = compact ? width / 2 : (width / REPORT_COLUMNS) * step
    const next = resizeAutomaticReportCard(
      baseSizes[card.id],
      event.key === "ArrowRight"
        ? horizontal
        : event.key === "ArrowLeft"
          ? -horizontal
          : 0,
      event.key === "ArrowDown"
        ? REPORT_ROW * step
        : event.key === "ArrowUp"
          ? -REPORT_ROW * step
          : 0,
      width,
      compact
    )
    onChange(setAutomaticReportSize(config, card.id, next))
    setAnnouncement(`已調整大小並自動整理：${card.title}`)
  }
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={automaticCollision}
        onDragEnd={({ active, over }) => {
          if (readonly || gesture.current || !over || active.id === over.id)
            return
          const card = cards.find((item) => item.id === active.id)
          if (!card || card.locked) return
          onChange(
            reorderReportPage(config, String(active.id), String(over.id))
          )
          setAnnouncement("已移動卡片並自動整理版面")
        }}
      >
        <SortableContext
          items={cards.map((card) => card.id)}
          strategy={rectSortingStrategy}
        >
          <div
            ref={board}
            aria-label="報表畫布"
            data-report-layout="automatic"
            className="grid w-full min-w-0"
            style={{
              gridTemplateColumns: `repeat(${REPORT_COLUMNS}, minmax(0, 1fr))`,
              gridAutoRows: REPORT_ROW,
            }}
          >
            {cards.map((card) => {
              const rect = rects[card.id]
              return (
                <div
                  key={card.id}
                  className="relative min-w-0 self-start p-1"
                  data-layout-card={card.id}
                  data-layout-rect={`${rect.x},${rect.y},${rect.w},${rect.h}`}
                  data-resizing={resizingId === card.id ? "both" : undefined}
                  style={
                    {
                      gridColumn: `${rect.x + 1} / span ${rect.w}`,
                      gridRow: `${rect.y + 1} / span ${rect.h}`,
                      zIndex: resizingId === card.id ? 20 : undefined,
                    } as CSSProperties
                  }
                >
                  {renderCard(card, {
                    fixedHeight: rect.h * REPORT_ROW - 8,
                    selected: selected.has(card.id),
                    draggable: !readonly && !card.locked,
                    onSelect: (event) => select(card, event),
                    onSize:
                      !readonly && !card.locked
                        ? (size) => {
                            onChange(
                              setAutomaticReportPreset(config, card.id, size)
                            )
                            setAnnouncement(
                              `已切換為${REPORT_WIDGET_PRESETS[size].label}尺寸並自動整理版面`
                            )
                          }
                        : undefined,
                  })}
                  {!readonly && !card.locked && (
                    <ReportWidgetResizeHandle
                      data-ui-demo="report-widget-resize"
                      aria-label={`調整尺寸：${card.title}`}
                      title="拖曳預覽大小，放開後自動整理版面；方向鍵微調、Esc 取消"
                      onPointerDown={(event) => start(event, card)}
                      onPointerMove={move}
                      onPointerUp={finish}
                      onPointerCancel={cancel}
                      onLostPointerCapture={cancel}
                      onKeyDown={(event) => keyboard(event, card)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )
}
