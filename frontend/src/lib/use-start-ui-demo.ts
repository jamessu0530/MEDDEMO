import { useLocation, useNavigate } from "react-router"
import { closeAssistant } from "@/ask/assistant-window"
import { pageDemoTarget } from "@/lib/page-demo-browser"
import { readUser } from "@/lib/auth"
import {
  canStartUiDemo,
  UI_DEMOS,
  uiDemoPathForRole,
  type UiDemoKind,
} from "@/lib/ui-demo"

/** 使用者送出示範要求後直接開始，不再插入另一張確認卡。 */
export function useStartUiDemo() {
  const navigate = useNavigate()
  const location = useLocation()
  return (kind: UiDemoKind, path?: string) => {
    closeAssistant()
    const requested =
      path && canStartUiDemo(kind, path)
        ? path
        : canStartUiDemo(kind, location.pathname)
          ? location.pathname + location.search
          : UI_DEMOS[kind].path
    const destination = uiDemoPathForRole(requested, readUser()?.role)
    const stay = destination === location.pathname + location.search
    const activeKind =
      kind === "create-order" && stay && pageDemoTarget("page-tour-dialog")
        ? "page-tour"
        : kind
    navigate(destination, {
      replace: stay,
      state: { ...(stay ? location.state : {}), startUiDemo: activeKind },
    })
  }
}
