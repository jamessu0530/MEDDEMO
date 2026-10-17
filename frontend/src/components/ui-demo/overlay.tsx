import { useEffect, useSyncExternalStore, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { MousePointer2 } from "@/components/icons"
import { useLocation, useNavigate } from "react-router"
import {
  canStartUiDemo,
  isUiDemoKind,
  matchesDemoPage,
  UI_DEMOS,
  type DemoState,
} from "@/lib/ui-demo"
import { uiDemo } from "@/lib/ui-demo-browser"
import "./ui-demo.css"

/** 跨頁移動的示範指標；雙擊或連點兩下接手，不插入結果提示頁。 */
export function UiDemoOverlay() {
  const state = useSyncExternalStore(uiDemo.subscribe, uiDemo.getSnapshot)
  const { pathname, search, key, state: locationState } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const path = pathname.replace(/\/$/, "")
    const kind =
      isUiDemoKind(locationState?.startUiDemo) &&
      canStartUiDemo(locationState.startUiDemo, path)
        ? locationState.startUiDemo
        : path === "/reports" && locationState?.startReportDemo
          ? "report-tour"
          : path === "/orders" && locationState?.startOrderDemo
            ? "create-order"
            : null
    if (kind) {
      uiDemo.start(kind)
      navigate(
        { pathname, search },
        {
          replace: true,
          state: {
            ...locationState,
            startOrderDemo: false,
            startReportDemo: false,
            startUiDemo: undefined,
          },
        }
      )
    }
  }, [pathname, search, key, locationState, navigate])
  useEffect(() => {
    const current = uiDemo.getSnapshot()
    if (
      current.status === "running" &&
      (current.kind === "page-tour"
        ? current.pageKey !== pathname + search
        : !matchesDemoPage(UI_DEMOS[current.kind].paths, pathname))
    )
      uiDemo.stop("已離開示範流程，現在由你操作。")
  }, [pathname, search, state.kind])
  if (state.status !== "running") return null
  return createPortal(<UiDemoPointer state={state} />, document.body)
}

export function UiDemoPointer({ state }: { state: DemoState }) {
  if (state.status !== "running") return null
  const rect = state.rect
  return <div data-ui-demo-overlay className="ui-demo-layer">
    <p className="sr-only" role="status" aria-live="polite">{state.text} 點兩下畫面或按 Esc 即可接手。</p>
    {rect && <>
      <div aria-hidden className="ui-demo-focus" style={{ left: rect.x - 5, top: rect.y - 5, width: rect.width + 10, height: rect.height + 10 }} />
      <div aria-hidden className={`ui-demo-pointer ${state.clicking ? "ui-demo-pointer-click" : ""}`} style={{
        left: rect.x + rect.width / 2,
        top: rect.y + rect.height / 2,
        "--pointer-x": `${rect.x + rect.width / 2}px`,
        "--pointer-y": `${rect.y + rect.height / 2}px`,
      } as CSSProperties}>
        <span className="ui-demo-ripple" />
        <MousePointer2 size={38} strokeWidth={1.5} fill="#9b51e0" stroke="white" />
        <span className="ui-demo-pointer-name">熊熊滾 · 點兩下接手</span>
      </div>
    </>}
  </div>
}
