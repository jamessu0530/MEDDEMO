import { useEffect, useRef, useState } from "react"
import { getReportRecipients, shareReportDocument } from "@/api/reports"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ReportShareDialog({
  reportId,
  revision,
  onClose,
}: {
  reportId: string
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
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>共享唯讀報表設定</DialogTitle>
        </DialogHeader>
        <label className="min-w-0 space-y-2 text-sm">
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
            className="min-h-10 rounded-md border px-3 text-sm"
            onClick={onClose}
          >
            關閉
          </button>
          <button
            className="min-h-10 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40"
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
