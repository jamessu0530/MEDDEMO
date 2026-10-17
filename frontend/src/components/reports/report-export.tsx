import { useEffect, useRef, useState } from "react"
import { Download, LoaderCircle } from "@/components/icons"
import { downloadReportFile, type ReportExportInput } from "@/api/reports"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { reportPages, type ReportQuery } from "@/lib/reports"

const INPUT = "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
export function ReportExportDialog({
  config,
  pageId,
  cardId,
  onClose,
}: {
  config: ReportQuery
  pageId: string
  cardId?: string
  onClose: () => void
}) {
  const [format, setFormat] = useState<ReportExportInput["format"]>("xlsx")
  const [data, setData] = useState<ReportExportInput["data"]>("summary")
  const [scope, setScope] = useState<"all" | "page" | "card">(
    cardId ? "card" : "all"
  )
  const [selectedCard, setSelectedCard] = useState(
    cardId ??
      config.cards.find((card) => (card.page_id ?? "overview") === pageId)
        ?.id ??
      config.cards[0]?.id ??
      ""
  )
  const [selection, setSelection] = useState<"chart" | "selected">("chart")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const pages = reportPages(config)
  const currentPage = pages.find((page) => page.id === pageId) ?? pages[0]
  const empty = !config.cards.some(
    (card) =>
      scope === "all" ||
      (scope === "page"
        ? (card.page_id ?? "overview") === currentPage.id
        : card.id === selectedCard)
  )
  const highlight =
    !!config.selection_groups?.length &&
    config.cards.some((card) => card.interaction === "highlight")
  function close() {
    controller.current?.abort()
    onClose()
  }
  async function download() {
    if (busy || empty) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError("")
    try {
      const body: ReportExportInput = {
        config,
        format,
        data,
        selection_scope: selection,
        ...(scope === "page"
          ? { page_id: currentPage.id }
          : scope === "card"
            ? { card_id: selectedCard }
            : {}),
      }
      const blob = await downloadReportFile(body, abort.signal)
      if (abort.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const card =
        scope === "card"
          ? config.cards.find((card) => card.id === selectedCard)?.title
          : scope === "page"
            ? currentPage.name
            : "整份報表"
      anchor.href = url
      anchor.download =
        `${config.name}-${card}-${data === "summary" ? "完整彙總" : "完整明細"}.${format}`.replace(
          /[\\/:*?"<>|\r\n]/g,
          "_"
        )
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "匯出未完成，請重試。")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>完整匯出報表</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="min-w-0 space-y-1.5 text-sm">
            <span>檔案格式</span>
            <select
              className={INPUT}
              aria-label="匯出檔案格式"
              data-ui-demo="report-export-format"
              value={format}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as typeof format
                setFormat(next)
                if (next === "pdf") {
                  setData("summary")
                  setScope("all")
                }
              }}
            >
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="pdf">整份報表 PDF</option>
            </select>
          </label>
          <label className="min-w-0 space-y-1.5 text-sm">
            <span>資料內容</span>
            <select
              className={INPUT}
              aria-label="匯出資料內容"
              value={data}
              disabled={busy || format === "pdf"}
              onChange={(event) => setData(event.target.value as typeof data)}
            >
              <option value="summary">完整彙總</option>
              <option value="details">實際明細</option>
            </select>
          </label>
        </div>
        <label className="min-w-0 space-y-1.5 text-sm">
          <span>匯出範圍</span>
          <select
            className={INPUT}
            aria-label="匯出報表範圍"
            value={scope}
            disabled={busy || format === "pdf"}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="all">
              整份報表
            </option>
            <option value="page">目前分頁：{currentPage.name}</option>
            <option value="card" disabled={!config.cards.length}>
              單一圖表
            </option>
          </select>
        </label>
        {scope === "card" && (
          <label className="min-w-0 space-y-1.5 text-sm">
            <span>選擇圖表</span>
            <select
              className={INPUT}
              aria-label="匯出圖表"
              value={selectedCard}
              disabled={busy}
              onChange={(event) => setSelectedCard(event.target.value)}
            >
              {config.cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {
                    pages.find(
                      (page) => page.id === (card.page_id ?? "overview")
                    )?.name
                  }{" "}
                  · {card.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {highlight && (
          <label className="space-y-1.5 text-sm">
            <span>醒目提示資料</span>
            <select
              className={INPUT}
              aria-label="匯出醒目提示範圍"
              value={selection}
              disabled={busy}
              onChange={(event) =>
                setSelection(event.target.value as typeof selection)
              }
            >
              <option value="chart">完整圖表範圍</option>
              <option value="selected">聯動選取的子集</option>
            </select>
          </label>
        )}
        {empty && (
          <p role="alert" className="text-xs text-destructive">
            {scope === "page"
              ? "目前分頁沒有圖表。"
              : "目前沒有可匯出的圖表，新增圖表後即可匯出。"}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {busy ? "取消匯出" : "關閉"}
          </Button>
          <Button
            data-ui-demo="report-export-download"
            onClick={() => void download()}
            disabled={busy || empty}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {busy ? "正在產生完整檔案…" : "下載完整檔案"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
