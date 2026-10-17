import type { StudioExploration } from "@/lib/report-studio"
import { useEffect, useRef, useState } from "react"
import { Bookmark, Copy, FilePlus2, Save } from "@/components/icons"
import {
  createReportBookmark,
  createReportDocument,
  openReportDocument,
} from "@/api/reports"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  captureReportBookmark,
  type ReportBookmark,
  type ReportLibrarySnapshot,
} from "@/lib/report-documents"
import { normalizeReportConfig, type ReportConfig } from "@/lib/reports"

const BUTTON =
  "flex min-h-10 items-center justify-center gap-1.5 rounded-md border bg-background px-2.5 text-sm disabled:opacity-40"
const INPUT =
  "h-10 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm"
export function ReportDocumentControls({
  config,
  library,
  pageId,
  dirty,
  saving,
  onOpen,
  onLibraryChange,
  onBookmark,
  requestAction,
  flushDraft,
  exploration,
}: {
  config: ReportConfig
  library: ReportLibrarySnapshot
  pageId: string
  exploration?: StudioExploration
  dirty: boolean
  saving: boolean
  onOpen: (snapshot: ReportLibrarySnapshot) => void
  onLibraryChange: (snapshot: ReportLibrarySnapshot) => void
  onBookmark: (bookmark: ReportBookmark) => void
  requestAction: (label: string, action: () => void | Promise<void>) => void
  flushDraft: () => boolean
}) {
  const [mode, setMode] = useState<"new" | "copy" | "save_as" | null>(null)
  const [name, setName] = useState("")
  const [bookmarkDialog, setBookmarkDialog] = useState(false)
  const [bookmarkName, setBookmarkName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const full = library.documents.length >= 20
  const existingBookmark = library.bookmarks.some(
    (item) =>
      item.name.toLocaleLowerCase() === bookmarkName.trim().toLocaleLowerCase()
  )
  const bookmarkFull = library.bookmarks.length >= 20 && !existingBookmark
  function begin(value: NonNullable<typeof mode>) {
    setName(
      value === "new"
        ? "我的新報表"
        : `${config.name.slice(0, 35)} ${value === "copy" ? "副本" : "另存"}`
    )
    setMode(value)
    setError("")
  }
  async function open(id: string) {
    if (id === library.active_report_id || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError("")
    try {
      const next = await openReportDocument(id, abort.signal)
      if (!abort.signal.aborted) onOpen(next)
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "報表暫時無法開啟。")
    } finally {
      setBusy(false)
    }
  }
  async function create() {
    if (!mode || !name.trim() || full) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError("")
    if (dirty) flushDraft()
    const next =
      mode === "new"
        ? normalizeReportConfig({
            name: name.trim(),
            template: config.template,
            period: "this_month",
            owner_id: null,
            customer_type: null,
            pages: [{ id: "overview", name: "總覽" }],
            cards: [
              {
                id: "sales-total",
                title: "銷售金額",
                metric: "sales",
                dimension: "none",
                visual: "kpi",
                limit: 5,
                height: "compact",
              },
            ],
          })
        : { ...config, name: name.trim() }
    try {
      const saved = await createReportDocument(
        next,
        mode === "new" ? undefined : library.active_report_id,
        abort.signal
      )
      if (!abort.signal.aborted) onOpen(saved)
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "新報表未能儲存。")
    } finally {
      setBusy(false)
    }
  }
  async function addBookmark() {
    if (dirty || !bookmarkName.trim() || bookmarkFull) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError("")
    try {
      const saved = await createReportBookmark(
        library.active_report_id,
        bookmarkName.trim(),
        captureReportBookmark(config, pageId, exploration),
        abort.signal
      )
      if (!abort.signal.aborted) {
        onLibraryChange(saved)
        setBookmarkDialog(false)
        setBookmarkName("")
      }
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "書籤未能儲存。")
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <details className="mb-3 rounded-lg border bg-muted/20">
        <summary className="min-h-10 cursor-pointer px-3 py-2.5 text-xs font-medium">
          報表與書籤
        </summary>
        <div className="space-y-2 p-2.5 pt-0" aria-label="報表管理">
          <div className="flex flex-wrap items-center gap-2">
            <label className="min-w-0 flex-[1_1_12rem] space-y-1 text-sm text-muted-foreground">
              <span>我的報表</span>
              <select
                className={INPUT}
                aria-label="切換命名報表"
                value={library.active_report_id}
                disabled={busy || saving}
                onChange={(event) => {
                  const id = event.target.value
                  requestAction("切換報表", () => open(id))
                }}
              >
                {library.documents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.readonly ? " · 唯讀" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || saving || full}
              onClick={() => requestAction("新建報表", () => begin("new"))}
            >
              <FilePlus2 className="size-3.5" />
              新建
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || saving || full}
              onClick={() => begin("copy")}
            >
              <Copy className="size-3.5" />
              複製報表
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || saving || full}
              onClick={() => begin("save_as")}
            >
              <Save className="size-3.5" />
              另存新報表
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="套用檢視書籤"
              className={`${INPUT} w-auto flex-[1_1_12rem]`}
              value=""
              disabled={busy || saving || !library.bookmarks.length}
              onChange={(event) => {
                const bookmark = library.bookmarks.find(
                  (item) => item.id === event.target.value
                )
                if (bookmark) onBookmark(bookmark)
              }}
            >
              <option value="">
                檢視書籤
              </option>
              {library.bookmarks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || saving || dirty || library.readonly}
              onClick={() => {
                setError("")
                setBookmarkDialog(true)
              }}
            >
              <Bookmark className="size-3.5" />
              儲存檢視書籤
            </button>
          </div>
          {error && !mode && !bookmarkDialog && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </details>
      <Dialog
        open={!!mode}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null)
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "new"
                ? "新建命名報表"
                : mode === "copy"
                  ? "複製目前報表"
                  : "另存為新報表"}
            </DialogTitle>
          </DialogHeader>
          <label className="space-y-1.5 text-sm">
            <span>新報表名稱</span>
            <input
              className={INPUT}
              aria-label="新報表名稱"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => setMode(null)}
            >
              取消
            </button>
            <button
              type="button"
              className={`${BUTTON} bg-primary text-primary-foreground`}
              disabled={busy || !name.trim() || full}
              onClick={() => void create()}
            >
              {busy ? "儲存中…" : "建立並開啟報表"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bookmarkDialog}
        onOpenChange={(open) => {
          if (!busy) setBookmarkDialog(open)
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle>儲存檢視書籤</DialogTitle>
          </DialogHeader>
          <label className="space-y-1.5 text-sm">
            <span>書籤名稱</span>
            <input
              className={INPUT}
              aria-label="檢視書籤名稱"
              maxLength={40}
              value={bookmarkName}
              onChange={(event) => setBookmarkName(event.target.value)}
            />
          </label>
          {existingBookmark && (
            <p className="text-xs text-muted-foreground">
              將更新同名書籤的檢視狀態。
            </p>
          )}
          {bookmarkFull && (
            <p role="alert" className="text-xs text-destructive">
              已達 20 個書籤，可輸入原名稱更新。
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            className={BUTTON}
            disabled={busy || dirty || !bookmarkName.trim() || bookmarkFull}
            onClick={() => void addBookmark()}
          >
            {busy
              ? "儲存中…"
              : existingBookmark
                ? "更新同名書籤"
                : "建立檢視書籤"}
          </button>
        </DialogContent>
      </Dialog>
    </>
  )
}
