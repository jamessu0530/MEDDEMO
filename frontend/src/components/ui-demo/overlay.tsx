import { useEffect, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { MousePointer2, Square, X } from "@/components/icons"
import { useLocation } from "react-router"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { ORDER_DEMO_STEPS } from "@/lib/ui-demo"
import { uiDemo } from "@/lib/ui-demo-browser"
import "./ui-demo.css"

/** 跨頁保留的操作提示；整層穿透點擊，只有停止／關閉鈕接收輸入。 */
export function UiDemoOverlay() {
  const state = useSyncExternalStore(uiDemo.subscribe, uiDemo.getSnapshot)
  const { pathname } = useLocation()
  useEffect(() => {
    if (!["/ask", "/orders", "/orders/demo"].includes(pathname))
      uiDemo.stop("已離開示範流程，現在由你操作。")
  }, [pathname])
  if (state.status === "idle") return null
  const running = state.status === "running"
  const rect = state.rect
  const onTop = rect && rect.y > window.innerHeight * 0.55
  return createPortal(
    <div data-ui-demo-overlay className="ui-demo-layer">
      {running && rect && (
        <>
          <div
            aria-hidden
            className="ui-demo-focus"
            style={{
              left: rect.x - 5,
              top: rect.y - 5,
              width: rect.width + 10,
              height: rect.height + 10,
            }}
          />
          <div
            aria-hidden
            className={`ui-demo-pointer ${state.clicking ? "ui-demo-pointer-click" : ""}`}
            style={{
              left: rect.x + rect.width / 2,
              top: rect.y + rect.height / 2,
            }}
          >
            <span className="ui-demo-ripple" />
            <MousePointer2
              size={38}
              strokeWidth={1.5}
              fill="#9b51e0"
              stroke="white"
            />
            <span className="ui-demo-pointer-name">熊熊滾</span>
          </div>
        </>
      )}
      <section
        aria-label="熊熊滾操作示範"
        className="ui-demo-card"
        style={
          onTop
            ? { top: "max(1rem, env(safe-area-inset-top))", bottom: "auto" }
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Mascot
            state={running ? "hi" : "think"}
            size={36}
            className="shrink-0"
          />
          <p className="min-w-0 flex-1 text-sm font-semibold">
            {running
              ? `熊熊滾示範中 · ${state.step}／${ORDER_DEMO_STEPS.length}`
              : state.status === "completed"
                ? "示範完成"
                : "示範已停止"}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={running ? "停止示範" : "關閉示範提示"}
            onClick={() => (running ? uiDemo.stop() : uiDemo.dismiss())}
          >
            {running ? <Square className="size-4" /> : <X className="size-4" />}
          </Button>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="mt-1 text-sm leading-relaxed"
        >
          {state.text}
        </p>
        {running && (
          <p className="mt-2 text-xs text-muted-foreground">
            碰一下畫面即可接手
          </p>
        )}
      </section>
    </div>,
    document.body
  )
}
