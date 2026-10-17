import { useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { closeAssistant } from "@/ask/assistant-window"
import { MousePointer2 } from "@/components/icons"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { canStartUiDemo, UI_DEMOS, type UiDemoKind } from "@/lib/ui-demo"
import { pageDemoTarget } from "@/lib/page-demo-browser"

export function UiDemoOffer({
  kind = "create-order",
  path,
}: {
  kind?: UiDemoKind
  path?: string
}) {
  const preset = UI_DEMOS[kind]
  const navigate = useNavigate()
  const location = useLocation()
  const [declined, setDeclined] = useState(false)
  if (declined)
    return (
      <p className="text-xs text-muted-foreground">好，需要時再請我示範。</p>
    )
  return (
    <section
      aria-label="熊熊滾的操作示範邀請"
      className="mr-4 space-y-3 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Mascot state="hi" size={48} className="shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">要不要我操作給你看？</h2>
          <p className="mt-1 text-sm leading-relaxed">{preset.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">{preset.note}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            closeAssistant()
            const destination =
              path && canStartUiDemo(kind, path)
                ? path
                : canStartUiDemo(kind, location.pathname)
                  ? location.pathname + location.search
                  : preset.path
            const stay = destination === location.pathname + location.search
            const activeKind =
              kind === "create-order" &&
              stay &&
              pageDemoTarget("page-tour-dialog")
                ? "page-tour"
                : kind
            navigate(destination, {
              replace: stay,
              state: {
                ...(stay ? location.state : {}),
                startUiDemo: activeKind,
              },
            })
          }}
        >
          <MousePointer2 className="size-4" />
          好，操作給我看
        </Button>
        <Button variant="ghost" onClick={() => setDeclined(true)}>
          我先自己試
        </Button>
      </div>
    </section>
  )
}
