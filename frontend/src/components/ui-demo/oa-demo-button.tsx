import { closeAssistant } from "@/ask/assistant-window"
import { MousePointer2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { uiDemo } from "@/lib/ui-demo-browser"

export function OaDemoButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <Button
      size="sm"
      className="min-h-11"
      variant="ghost"
      disabled={disabled}
      onClick={() => {
        closeAssistant()
        uiDemo.start("oa-tour")
      }}
    >
      <MousePointer2 className="size-4" />
      操作給我看
    </Button>
  )
}
