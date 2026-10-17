import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { GripHorizontal, GripVertical, RotateCcw } from "@/components/icons"

import { useAuth } from "@/lib/auth"
import { constrainManagerMapSize, managerMapLimits, readManagerMapSize, saveManagerMapSize, type ManagerMapSize, type MapSizeLimits } from "@/lib/manager-map-size"
import { useIsWide } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

type Props = { map: ReactNode; children: ReactNode }
type Axis = "width" | "height"
type Drag = {
  axis: Axis
  pointerId: number
  x: number
  y: number
  width: number
  height: number
  availableWidth: number
  limits: MapSizeLimits
  size: ManagerMapSize
}

/** 團隊總覽與個別業務共用尺寸，Demo 身分切換也沿用真正登入帳號的偏好。 */
export function ResizableMapLayout(props: Props) {
  const user = useAuth()?.user
  const accountId = user?.demo?.account.id ?? user?.id ?? "device"
  return <MapLayout key={accountId} accountId={accountId} {...props} />
}

function MapLayout({ accountId, map, children }: Props & { accountId: string }) {
  const id = useId()
  const wide = useIsWide()
  const grid = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState(() => readManagerMapSize(accountId))
  const [resizing, setResizing] = useState<Axis | null>(null)
  const [metrics, setMetrics] = useState({ availableWidth: 0, fontSize: 16, viewportHeight: 720, mapTop: 0 })
  const limits = managerMapLimits(metrics.availableWidth, metrics.fontSize, metrics.viewportHeight, metrics.mapTop)
  const effective = constrainManagerMapSize({
    widthPercent: size.widthPercent ?? (wide ? 60 : 50),
    height: size.height ?? metrics.viewportHeight - 12 * metrics.fontSize,
  }, limits)
  const width = effective.widthPercent!
  const height = effective.height!

  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return
    const measure = () => {
      const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const mapTop = Math.max(4.5 * fontSize, element.getBoundingClientRect().top)
      const next = { availableWidth: element.clientWidth - 1.5 * fontSize, fontSize, viewportHeight: window.innerHeight, mapTop }
      setMetrics((current) => current.availableWidth === next.availableWidth && current.fontSize === next.fontSize && current.viewportHeight === next.viewportHeight && current.mapTop === next.mapTop ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  function commit(next: ManagerMapSize) {
    setSize(next)
    saveManagerMapSize(accountId, next)
  }

  function startResize(axis: Axis, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { axis, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width, height, availableWidth: metrics.availableWidth, limits, size }
    setResizing(axis)
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = constrainManagerMapSize({
      ...current.size,
      ...(current.axis === "width"
        ? { widthPercent: current.width + (event.clientX - current.x) / Math.max(1, current.availableWidth) * 100 }
        : { height: current.height + event.clientY - current.y }),
    }, current.limits)
    current.size = next
    setSize(next)
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(null)
    commit(current.size)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resizeWithKey(axis: Axis, event: KeyboardEvent<HTMLDivElement>) {
    const decrease = axis === "width" ? "ArrowLeft" : "ArrowUp"
    const increase = axis === "width" ? "ArrowRight" : "ArrowDown"
    if (![decrease, increase, "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const value = axis === "width" ? width : height
    const min = axis === "width" ? limits.minWidth : limits.minHeight
    const max = axis === "width" ? limits.maxWidth : limits.maxHeight
    const step = (axis === "width" ? 2 : 16) * (event.shiftKey ? 3 : 1)
    const next = event.key === "Home" ? min : event.key === "End" ? max : value + (event.key === decrease ? -step : step)
    commit(constrainManagerMapSize({ ...size, ...(axis === "width" ? { widthPercent: next } : { height: next }) }, limits))
  }

  const handleClass = "group flex touch-none items-center justify-center rounded-lg text-muted-foreground outline-offset-2 hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"

  return (
    <section aria-label="可調整大小的地圖與行程" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>拖曳分隔線調整地圖大小</p>
        <button type="button" className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" onClick={() => commit({ widthPercent: null, height: null })}>
          <RotateCcw className="size-3.5" />
          還原大小
        </button>
      </div>
      <div
        ref={grid}
        className={cn("grid items-start", resizing && "select-none")}
        style={{ gridTemplateColumns: `minmax(0,${width}fr) 1.5rem minmax(0,${100 - width}fr)`, "--manager-map-height": `${height}px` } as CSSProperties}
      >
        <div className="sticky top-[4.5rem] min-w-0">
          <div id={`${id}-map`} className={cn(resizing && "pointer-events-none")}>{map}</div>
          <div
            role="separator"
            tabIndex={0}
            aria-label="調整地圖高度"
            aria-controls={`${id}-map`}
            aria-orientation="horizontal"
            aria-valuemin={Math.round(limits.minHeight)}
            aria-valuemax={Math.round(limits.maxHeight)}
            aria-valuenow={Math.round(height)}
            aria-valuetext={`地圖高度 ${Math.round(height)} 像素`}
            title="上下拖曳或按 ↑↓ 調整地圖高度"
            className={cn(handleClass, "mt-1 h-7 cursor-row-resize gap-1.5 text-xs", resizing === "height" && "bg-primary/10 text-primary")}
            onPointerDown={(event) => startResize("height", event)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={finishResize}
            onKeyDown={(event) => resizeWithKey("height", event)}
          >
            <GripHorizontal className="size-4" />
            <span>調整高度</span>
          </div>
        </div>
        <div
          role="separator"
          tabIndex={0}
          aria-label="調整地圖寬度"
          aria-controls={`${id}-map`}
          aria-orientation="vertical"
          aria-valuemin={Math.round(limits.minWidth)}
          aria-valuemax={Math.round(limits.maxWidth)}
          aria-valuenow={Math.round(width)}
          aria-valuetext={`地圖寬度 ${Math.round(width)}%`}
          title="左右拖曳或按 ←→ 調整地圖寬度"
          className={cn(handleClass, "sticky top-[4.5rem] cursor-col-resize", resizing === "width" && "bg-primary/10 text-primary")}
          style={{ height }}
          onPointerDown={(event) => startResize("width", event)}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onKeyDown={(event) => resizeWithKey("width", event)}
        >
          <span className="flex h-14 w-5 items-center justify-center rounded-full border bg-card shadow-sm group-hover:border-primary/40">
            <GripVertical className="size-4" />
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-3">{children}</div>
      </div>
    </section>
  )
}
