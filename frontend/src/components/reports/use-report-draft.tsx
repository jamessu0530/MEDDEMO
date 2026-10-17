import { useCallback, useEffect, useRef, useState } from "react"
import { validateReportDraft } from "@/api/reports"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  readReportLocalDraft,
  reportDraftKey,
  writeReportLocalDraft,
} from "@/lib/report-documents"
import type { ReportConfig } from "@/lib/reports"

const ACTION = "min-h-10 rounded-md border px-3 text-sm disabled:opacity-40"

export function useReportDraft({
  accountId,
  reportId,
  config,
  pageId,
  revision,
  savedKey,
  dirty,
  saving,
  onRestore,
  onSave,
}: {
  accountId: string
  reportId: string
  config: ReportConfig
  pageId: string
  revision: number
  savedKey: string
  dirty: boolean
  saving: boolean
  onRestore: (
    config: ReportConfig,
    pageId: string,
    revision: number,
    conflict: boolean
  ) => void
  onSave: () => Promise<boolean>
}) {
  const [recoverable, setRecoverable] = useState(() => {
    if (!accountId || typeof window === "undefined") return null
    try {
      const draft = readReportLocalDraft(
        window.localStorage,
        accountId,
        reportId
      )
      return draft && JSON.stringify(draft.config) !== savedKey ? draft : null
    } catch {
      return null
    }
  })
  const [error, setError] = useState("")
  const [written, setWritten] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [pending, setPending] = useState<{
    label: string
    action: () => void | Promise<void>
  } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const restoreController = useRef<AbortController | null>(null)
  useEffect(() => () => restoreController.current?.abort(), [])

  const flush = useCallback(() => {
    if (!accountId || !dirty || recoverable) return !dirty
    try {
      const updated_at = new Date().toISOString()
      writeReportLocalDraft(window.localStorage, {
        version: 1,
        account_id: accountId,
        report_id: reportId,
        revision,
        saved_key: savedKey,
        config,
        page_id: pageId,
        updated_at,
      })
      setWritten(updated_at)
      setError("")
      return true
    } catch {
      setError("本機草稿未能寫入，請先將報表儲存到帳號。")
      return false
    }
  }, [
    accountId,
    dirty,
    recoverable,
    reportId,
    revision,
    savedKey,
    config,
    pageId,
  ])
  useEffect(() => {
    if (!accountId || recoverable) return
    if (!dirty) {
      try {
        window.localStorage.removeItem(reportDraftKey(accountId, reportId))
      } catch {
        /* 帳號版本仍已保存。 */
      }
      return
    }
    const timer = window.setTimeout(flush, 350)
    return () => window.clearTimeout(timer)
  }, [accountId, reportId, dirty, recoverable, flush])

  const latestFlush = useRef(flush)
  useEffect(() => {
    latestFlush.current = flush
  }, [flush])
  // 暫時隱藏工作區前，立即保留最後一次修改，不必等草稿的延遲寫入。
  useEffect(
    () => () => {
      latestFlush.current()
    },
    []
  )

  const requestAction = useCallback(
    async (label: string, action: () => void | Promise<void>) => {
      if (!dirty && !saving) {
        void action()
        return
      }
      flush()
      if (await onSave()) {
        await action()
        return
      }
      setPending({ label, action })
    },
    [dirty, saving, flush, onSave]
  )

  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => {
      flush()
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", unload)
    return () => {
      window.removeEventListener("beforeunload", unload)
    }
  }, [dirty, flush])

  async function restore() {
    if (!recoverable) return
    const controller = new AbortController()
    restoreController.current = controller
    setRestoring(true)
    setError("")
    try {
      const validated = await validateReportDraft(
        recoverable.config,
        controller.signal
      )
      if (controller.signal.aborted) return
      onRestore(
        validated,
        recoverable.page_id,
        recoverable.revision,
        recoverable.revision !== revision || recoverable.saved_key !== savedKey
      )
      setRecoverable(null)
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "草稿暫時無法復原。")
    } finally {
      setRestoring(false)
    }
  }
  async function continueAfterSave() {
    if (!pending) return
    setLeaving(true)
    try {
      if (await onSave()) {
        const action = pending.action
        setPending(null)
        await action()
      } else setError("儲存未成功，草稿仍保留。請重試，或保留草稿後繼續。")
    } finally {
      setLeaving(false)
    }
  }
  async function continueWithDraft() {
    if (!flush()) return
    if (pending) {
      const action = pending.action
      setPending(null)
      await action()
    }
  }
  return {
    recovering: !!recoverable,
    requestAction,
    flush,
    status:
      error ||
      (dirty && written
        ? `本機草稿已保留 ${new Date(written).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`
        : ""),
    dialogs: (
      <>
        <Dialog open={!!recoverable}>
          <DialogContent showCloseButton={false} className="max-w-md">
            <DialogHeader>
              <DialogTitle>復原未儲存草稿</DialogTitle>
              <DialogDescription>
                這份報表在本機有{" "}
                {recoverable
                  ? new Date(recoverable.updated_at).toLocaleString("zh-TW")
                  : ""}{" "}
                的草稿。復原前會重新驗證設定及目前可用的業務範圍。
              </DialogDescription>
            </DialogHeader>
            {recoverable &&
              (recoverable.revision !== revision ||
                recoverable.saved_key !== savedKey) && (
                <p className="text-xs text-amber-700">
                  帳號版本已變更。復原後可另存新報表，避免覆寫較新版本。
                </p>
              )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={ACTION}
                disabled={restoring}
                onClick={() => {
                  setRecoverable(null)
                  setError("")
                }}
              >
                使用帳號版本
              </button>
              <button
                type="button"
                className={`${ACTION} bg-primary text-primary-foreground`}
                disabled={restoring}
                onClick={() => void restore()}
              >
                {restoring ? "驗證草稿中…" : "復原本機草稿"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!pending}
          onOpenChange={(open) => {
            if (!open && !leaving && !saving) {
              setPending(null)
            }
          }}
        >
          <DialogContent showCloseButton={false} className="max-w-md">
            <DialogHeader>
              <DialogTitle>報表尚未儲存</DialogTitle>
              <DialogDescription>
                {pending?.label}
                前，可先儲存到帳號，或保留本機草稿後繼續。草稿只包含報表設定，不含查詢結果，會在此裝置保留 14 天。
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={ACTION}
                disabled={leaving || saving}
                onClick={() => {
                  setPending(null)
                }}
              >
                繼續編輯
              </button>
              <button
                type="button"
                className={ACTION}
                disabled={leaving || saving}
                onClick={() => void continueWithDraft()}
              >
                保留草稿並繼續
              </button>
              <button
                type="button"
                className={`${ACTION} bg-primary text-primary-foreground`}
                disabled={leaving || saving}
                onClick={() => void continueAfterSave()}
              >
                重試同步並繼續
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    ),
  }
}
