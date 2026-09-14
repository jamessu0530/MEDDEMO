import { Loader2 } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { formatElapsed } from "@/lib/format"
import { uploadQueue, useUploadQueue, type QueuedRecording } from "@/lib/offline-queue"

/** 首頁上的手機錄音（原型「沒訊號 · 待送出」，FR-4.3）：待送出的列在這裡、恢復連線自動送出，送出後提示去確認 */
export function PendingUploads() {
  const { items, online, sending } = useUploadQueue()
  if (items.length === 0) return null
  const pending = items.filter((item) => item.state === "pending")

  return (
    <section className="mb-3 rounded-xl border bg-card px-4 pb-1">
      <div className="flex min-h-12 items-center justify-between gap-2">
        <p className="text-sm font-semibold">{pending.length > 0 ? `待送出 ${pending.length} 筆` : "手機裡的錄音"}</p>
        {!online && <span className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">目前離線</span>}
        {online && sending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            送出中
          </span>
        )}
        {online && !sending && pending.length > 0 && (
          <Button variant="outline" size="sm" className="h-9" onClick={() => void uploadQueue.flush()}>
            現在送出
          </Button>
        )}
      </div>
      {items.map((item) => (
        <Row key={item.clientRef} item={item} />
      ))}
      {pending.length > 0 && (
        <p className="border-t py-2.5 text-xs text-muted-foreground">回到有收訊的地方會自動送出，不需要再操作一次。</p>
      )}
    </section>
  )
}

function Row({ item }: { item: QueuedRecording }) {
  const time = new Date(item.recordedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })
  const meta = `${formatElapsed(item.durationSeconds)} · ${time} 錄製`
  return (
    <div className="flex min-h-14 items-center gap-3 border-t py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.customerName}</p>
        <p className="text-xs text-muted-foreground">{item.state === "failed" ? `送不出去：${item.error}` : meta}</p>
      </div>
      {item.state === "pending" && (
        <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs whitespace-nowrap text-destructive">待送出</span>
      )}
      {item.state === "sent" && (
        <Link
          to={`/visits/${item.visitId}`}
          onClick={() => void uploadQueue.remove(item.clientRef)}
          className="shrink-0 rounded-md px-2 py-2 text-sm font-medium text-primary"
        >
          已送出，去確認
        </Link>
      )}
      {item.state === "failed" && (
        <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => void uploadQueue.remove(item.clientRef)}>
          刪除
        </Button>
      )}
    </div>
  )
}
