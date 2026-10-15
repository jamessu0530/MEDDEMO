import { useEffect, useRef, useState } from "react"
import { Download, LoaderCircle } from "lucide-react"
import { downloadReportFile, type ReportExportInput } from "@/api/reports"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
      config.cards[0].id
  )
  const [selection, setSelection] = useState<"chart" | "selected">("chart")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const pages = reportPages(config)
  const currentPage = pages.find((page) => page.id === pageId) ?? pages[0]
  const empty =
    scope === "page" &&
    !config.cards.some(
      (card) => (card.page_id ?? "overview") === currentPage.id
    )
  const highlight =
    !!config.selection_groups?.length &&
    config.cards.some((card) => card.interaction === "highlight")
  function close() {
    controller.current?.abort()
    onClose()
  }
  async function download() {
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
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>完整匯出報表</DialogTitle>
          <DialogDescription>
            直接匯出目前權限與有效條件內的完整資料，不受畫面前 N
            筆、其他系列或矩陣分頁限制。
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="min-w-0 space-y-1.5 text-xs">
            <span>檔案格式</span>
            <select
              className={INPUT}
              aria-label="匯出檔案格式"
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
          <label className="min-w-0 space-y-1.5 text-xs">
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
        <label className="min-w-0 space-y-1.5 text-xs">
          <span>匯出範圍</span>
          <select
            className={INPUT}
            aria-label="匯出報表範圍"
            value={scope}
            disabled={busy || format === "pdf"}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="all">
              整份報表（{pages.length} 頁、{config.cards.length} 張圖表）
            </option>
            <option value="page">目前分頁：{currentPage.name}</option>
            <option value="card">單一圖表</option>
          </select>
        </label>
        {scope === "card" && (
          <label className="min-w-0 space-y-1.5 text-xs">
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
          <label className="space-y-1.5 text-xs">
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
        <div className="space-y-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            {data === "summary"
              ? "包含完整實際分組、各層小計與總計；比率、平均及去重數不能跨列直接加總。"
              : "每列是實際交易品項、拜訪或目前快照。不同圖表可能包含同筆紀錄；明細只匯出本期資料。"}
          </p>
          <p>
            {format === "pdf"
              ? "PDF 以數值摘要圖與完整表格重排所有分頁；不保留畫布座標，包含在手機隱藏的圖表。"
              : format === "csv"
                ? "CSV 含資料類型及每張圖的匯出條件列，數值使用完整原始單位；百分比 0.5 代表 50%。"
                : "每張圖獨立工作表，附完整篩選條件、數值及日期格式。百分比儲存比例並以百分比顯示。"}
          </p>
        </div>
        {empty && (
          <p role="alert" className="text-xs text-destructive">
            目前分頁沒有圖表。
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
          <Button onClick={() => void download()} disabled={busy || empty}>
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
