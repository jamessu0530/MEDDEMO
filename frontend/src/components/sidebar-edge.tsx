import { useEffect, useRef, useState, type PointerEvent } from "react"

import { cn } from "@/lib/utils"

type Drag = { pointerId: number; x: number; y: number; width: number; fontSize: number; moved: boolean }

/** 邊緣可點擊，也可用滑鼠、手指或觸控筆拖曳；預覽寬度同步給所有固定元件。 */
export function SidebarEdge({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => { document.documentElement.style.removeProperty("--app-sidebar-width") }, [])

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    suppressClick.current = false
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: (collapsed ? 4 : 14) * fontSize, fontSize, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!current.moved && Math.abs(dx) < 8) return
    if (!current.moved && Math.abs(dy) > Math.abs(dx)) return
    current.moved = true
    setDragging(true)
    const width = Math.min(14 * current.fontSize, Math.max(4 * current.fontSize, current.width + dx))
    document.documentElement.style.setProperty("--app-sidebar-width", `${width}px`)
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    suppressClick.current = current.moved || cancelled || Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 8
    setDragging(false)
    document.documentElement.style.removeProperty("--app-sidebar-width")
    const dx = event.clientX - current.x
    if (!cancelled && current.moved && (collapsed ? dx > 40 : dx < -40)) onToggle()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <button
      type="button"
      aria-label={collapsed ? "向右拖曳或點擊展開側邊欄" : "向左拖曳或點擊收合側邊欄"}
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      title={collapsed ? "向右拖曳展開側邊欄" : "向左拖曳收合側邊欄"}
      className={cn("sidebar-edge group fixed inset-y-0 z-40 hidden w-6 touch-none items-center justify-center outline-none select-none lg:flex", dragging ? "cursor-grabbing" : "cursor-ew-resize")}
      style={{ left: "calc(var(--app-sidebar-width) - 0.75rem)" }}
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false
          return
        }
        onToggle()
      }}
    >
      <span aria-hidden className="widget-glass flex h-16 w-3.5 items-center justify-center rounded-full opacity-0 transition-[width,background-color,box-shadow,opacity] group-hover:w-5 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-ring group-data-[dragging=true]:w-5 group-data-[dragging=true]:opacity-100">
        <span className="h-7 w-0.5 rounded-full bg-muted-foreground/50 group-hover:bg-primary" />
      </span>
    </button>
  )
}
