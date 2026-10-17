import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { useAuth } from "@/lib/auth"
import { constrainManagerMapSize, managerMapLimits, readManagerMapSize, saveManagerMapSize, type ManagerMapSize, type MapSizeLimits } from "@/lib/manager-map-size"
import { useIsWide } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

type Props = { map: ReactNode; children: ReactNode }
type Axis = "width" | "height" | "both"
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
  initialSize: ManagerMapSize
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
  // 預留外框、圖例、邊角把手與共用助理輸入列，避免拖曳區被輸入列蓋住。
  const limits = managerMapLimits(metrics.availableWidth, metrics.fontSize, metrics.viewportHeight, metrics.mapTop, 11 * metrics.fontSize)
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
      const mapTop = Math.max(4.5 * fontSize, element.getBoundingClientRect().top + window.scrollY)
      const next = { availableWidth: element.clientWidth - 1.25 * fontSize, fontSize, viewportHeight: window.innerHeight, mapTop }
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

  function startResize(axis: Axis, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { axis, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width, height, availableWidth: metrics.availableWidth, limits, size, initialSize: size }
    setResizing(axis)
  }

  function moveResize(event: PointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = constrainManagerMapSize({
      ...current.size,
      ...(current.axis !== "height" && { widthPercent: current.width + (event.clientX - current.x) / Math.max(1, current.availableWidth) * 100 }),
      ...(current.axis !== "width" && { height: current.height + event.clientY - current.y }),
    }, current.limits)
    current.size = next
    setSize(next)
  }

  function finishResize(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(null)
    if (cancelled) setSize(current.initialSize)
    else commit(current.size)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resizeWithKey(axis: Axis, event: KeyboardEvent<HTMLElement>) {
    if (axis === "both") {
      if (event.key === "Escape") {
        const current = drag.current
        if (current) {
          event.preventDefault()
          drag.current = null
          setResizing(null)
          setSize(current.initialSize)
          if (event.currentTarget.hasPointerCapture(current.pointerId)) event.currentTarget.releasePointerCapture(current.pointerId)
        }
        return
      }
      axis = ["ArrowUp", "ArrowDown"].includes(event.key) ? "height" : "width"
    }
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

  const handleClass = "group absolute z-10 flex touch-none items-center justify-center rounded-full text-muted-foreground outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"

  return (
    <section aria-label="可調整大小的地圖與行程">
      <div
        ref={grid}
        className={cn("grid items-start gap-5", resizing && "select-none")}
        style={{ gridTemplateColumns: `minmax(0,${width}fr) minmax(0,${100 - width}fr)`, "--manager-map-height": `${height}px` } as CSSProperties}
      >
        <div className="manager-map-widget sticky top-[4.5rem] min-w-0 p-2" data-resizing={resizing || undefined}>
          <div id={`${id}-map`} className={cn("manager-map-content", resizing && "pointer-events-none")}>{map}</div>
          <p id={`${id}-hint`} className="sr-only">拖曳右下角調整大小，或按方向鍵微調。</p>
          <button
            type="button"
            aria-label="調整地圖大小"
            aria-controls={`${id}-map`}
            aria-describedby={`${id}-hint`}
            title="拖曳調整寬高；方向鍵微調，Shift 加快，Esc 取消拖曳"
            className="manager-map-corner absolute -right-3 -bottom-3 z-20 size-20 touch-none cursor-nwse-resize border-0 bg-transparent p-0 outline-none"
            onPointerDown={(event) => startResize("both", event)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={(event) => finishResize(event, true)}
            onLostPointerCapture={(event) => finishResize(event, true)}
            onKeyDown={(event) => resizeWithKey("both", event)}
          >
            <svg aria-hidden="true" width="0" height="0" className="absolute">
              <defs>
                <clipPath id={`${id}-corner-clip`} clipPathUnits="objectBoundingBox">
                  <path d="M .9875 .45 A .5375 .5375 0 0 1 .45 .9875 A .1375 .1375 0 0 1 .45 .7125 A .2625 .2625 0 0 0 .7125 .45 A .1375 .1375 0 0 1 .9875 .45 Z" />
                </clipPath>
              </defs>
            </svg>
            <span aria-hidden className="manager-map-corner-material absolute inset-0" style={{ clipPath: `url(#${id}-corner-clip)` }} />
            <svg aria-hidden="true" viewBox="0 0 80 80" className="manager-map-corner-rim pointer-events-none absolute inset-0 size-full" fill="none">
              <defs>
                <linearGradient id={`${id}-corner-rim`} x1="22" y1="22" x2="76" y2="76" gradientUnits="userSpaceOnUse">
                  <stop stopColor="white" stopOpacity=".95" />
                  <stop offset=".45" stopColor="white" stopOpacity=".65" />
                  <stop offset="1" stopColor="black" stopOpacity=".3" />
                </linearGradient>
              </defs>
              <path d="M 79 36 A 43 43 0 0 1 36 79 A 11 11 0 0 1 36 57 A 21 21 0 0 0 57 36 A 11 11 0 0 1 79 36 Z" stroke={`url(#${id}-corner-rim)`} strokeWidth="1.5" />
              <path d="M 59 36 A 9 9 0 0 1 75.5 31 M 36 59 A 23 23 0 0 0 59 36" stroke="white" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
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
            className={cn(handleClass, "inset-x-8 bottom-0 h-3 cursor-row-resize", resizing === "height" && "text-primary")}
            onPointerDown={(event) => startResize("height", event)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={(event) => finishResize(event, true)}
            onLostPointerCapture={(event) => finishResize(event, true)}
            onKeyDown={(event) => resizeWithKey("height", event)}
          >
            <span aria-hidden className="h-1 w-8 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-40 group-focus-visible:opacity-60" />
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
            className={cn(handleClass, "top-12 right-0 bottom-16 w-3 cursor-col-resize", resizing === "width" && "text-primary")}
            onPointerDown={(event) => startResize("width", event)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={(event) => finishResize(event, true)}
            onLostPointerCapture={(event) => finishResize(event, true)}
            onKeyDown={(event) => resizeWithKey("width", event)}
          >
            <span aria-hidden className="h-8 w-1 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-40 group-focus-visible:opacity-60" />
          </div>
        </div>
        <div className="manager-route-widgets flex min-w-0 flex-col gap-3">{children}</div>
      </div>
    </section>
  )
}
