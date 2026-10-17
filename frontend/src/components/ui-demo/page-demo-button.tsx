import { useLocation } from "react-router"
import { closeAssistant } from "@/ask/assistant-window"
import { MousePointer2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { pageDemoTarget } from "@/lib/page-demo-browser"
import { canStartUiDemo, uiDemoKindForPage } from "@/lib/ui-demo"
import { uiDemo } from "@/lib/ui-demo-browser"

export function PageDemoButton({
  currentOnly = false,
  iconOnly = false,
}: {
  currentOnly?: boolean
  iconOnly?: boolean
}) {
  const { pathname, search } = useLocation()
  return (
    <Button
      data-ui-demo-entry
      type="button"
      size="sm"
      variant="ghost"
      className={iconOnly ? "size-9 p-0" : "min-h-11 gap-1.5"}
      aria-label={iconOnly ? "操作給我看" : undefined}
      title={iconOnly ? "操作給我看" : undefined}
      disabled={!canStartUiDemo("page-tour", pathname)}
      onClick={() => {
        closeAssistant()
        const kind = currentOnly
          ? "page-tour"
          : uiDemoKindForPage(pathname, search)
        uiDemo.start(
          kind === "create-order" && pageDemoTarget("page-tour-dialog")
            ? "page-tour"
            : kind
        )
      }}
    >
      <MousePointer2 className="size-4" />
      {!iconOnly && "操作給我看"}
    </Button>
  )
}
