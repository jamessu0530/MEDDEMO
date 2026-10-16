import { useState } from "react"
import { MousePointer2 } from "@/components/icons"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { uiDemo } from "@/lib/ui-demo-browser"

export function UiDemoOffer() {
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
          <p className="mt-1 text-sm leading-relaxed">
            我會用紫色箭頭示範新增訂單。你隨時碰一下畫面、捲動或按鍵，我就停下來，換你操作。
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            使用練習資料，最後的發送步驟會留給你確認。
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => uiDemo.start()}>
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
