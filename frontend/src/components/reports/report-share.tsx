import { useEffect, useRef, useState } from "react"
import { getReportRecipients, shareReportDocument } from "@/api/reports"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

export function ReportShareDialog({
  reportId,
  name,
  revision,
  onClose,
}: {
  reportId: string
  name: string
  revision: number
  onClose: () => void
}) {
  const [recipients, setRecipients] = useState<
    { id: string; name: string }[] | null
  >(null)
  const [recipient, setRecipient] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    getReportRecipients(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setRecipients(value)
      })
      .catch((err) => {
        if (!abort.signal.aborted)
          setError(
            err instanceof Error ? err.message : "帳號清單暫時載入不了。"
          )
      })
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [])
  async function share() {
    if (!recipient || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await shareReportDocument(
        reportId,
        recipient,
        revision,
        abort.signal
      )
      if (!abort.signal.aborted)
        setMessage(
          `已${result.updated ? "更新" : "共享"}給 ${result.recipient_name}。對方可從報表清單開啟「${result.report_name} · 唯讀」。`
        )
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "共享未完成。")
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>共享唯讀報表設定</DialogTitle>
          <DialogDescription>
            「{name}」已儲存版本 {revision}
            。接收者取得這一版設定快照，原報表往後修改時需再次共享才會更新。
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-muted-foreground">
          只共享名稱、圖表、版面及固定條件；查詢結果、草稿與暫時選取不會複製。接收者以自己的資料權限重新查詢，可探索、刷新及匯出，需另存才能編輯。不會寄送通知或建立公開連結。
        </p>
        <label className="min-w-0 space-y-2 text-xs">
          既有帳號
          <select
            aria-label="唯讀共享接收帳號"
            className="mt-2 h-11 w-full min-w-0 rounded-md border bg-background px-2"
            disabled={busy || !recipients?.length}
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value)
              setMessage("")
            }}
          >
            <option value="">
              {recipients === null
                ? "載入帳號中…"
                : recipients.length
                  ? "選擇接收帳號"
                  : "目前沒有可共享的帳號"}
            </option>
            {recipients?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.id}）
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          清單限同團隊既有帳號；管理帳號依既有組織範圍提供。示範代理帳號不提供共享。
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-xs text-primary">
            {message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-10 rounded-md border px-3 text-xs"
            onClick={onClose}
          >
            關閉
          </button>
          <button
            className="min-h-10 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-40"
            disabled={busy || !recipient || !!message}
            onClick={() => void share()}
          >
            {busy ? "正在共享…" : "共享設定快照"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
