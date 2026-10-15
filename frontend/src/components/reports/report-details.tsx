import { useEffect, useMemo, useRef, useState } from "react"
import { Download, LoaderCircle } from "lucide-react"
import {
  downloadReportDetails,
  downloadReportFile,
  getReportDetails,
  type ReportDetails,
  type ReportDetailsInput,
} from "@/api/reports"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import {
  detailCsvFilename,
  detailPageCount,
  detailValue,
} from "@/lib/report-details"
import {
  METRICS,
  formatReportExactValue,
  type ReportCard,
  type ReportQuery,
  type ReportSelectionPoint,
} from "@/lib/reports"

type Result =
  { key: string; data: ReportDetails } | { key: string; error: string }

export function ReportDetailsDialog({
  config,
  card,
  point,
  onClose,
}: {
  config: ReportQuery
  card: ReportCard
  point?: ReportSelectionPoint
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortBy, setSortBy] = useState<ReportDetailsInput["sort_by"]>(
    card.metric === "customers" ? "customer" : "date"
  )
  const [direction, setDirection] = useState<"asc" | "desc">(
    card.metric === "customers" ? "asc" : "desc"
  )
  const hasHighlight =
    card.interaction === "highlight" && Boolean(config.selection_groups?.length)
  const [scope, setScope] = useState<"chart" | "selected">("chart")
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportController = useRef<AbortController | null>(null)
  const body = useMemo<ReportDetailsInput>(
    () => ({
      config,
      card_id: card.id,
      point,
      selection_scope: scope,
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_direction: direction,
    }),
    [config, card.id, point, scope, page, pageSize, sortBy, direction]
  )
  const key = JSON.stringify(body)
  useEffect(() => {
    const controller = new AbortController()
    getReportDetails(body, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: error instanceof Error ? error.message : "明細暫時載入不了",
          })
      })
    return () => controller.abort()
  }, [body, key, attempt])
  useEffect(() => () => exportController.current?.abort(), [])
  const data = result?.key === key && "data" in result ? result.data : null
  const error = result?.key === key && "error" in result ? result.error : null
  // 切換頁碼時保留已知欄位，避免排序選單閃動；資料列仍由查詢 key 決定。
  const columns = result && "data" in result ? result.data.columns : []
  const pages = detailPageCount(data?.total_rows ?? 0, pageSize)
  const snapshot = card.metric === "customers" || card.metric === "overdue"

  async function exportDetails(format: "csv" | "xlsx") {
    const controller = new AbortController()
    exportController.current = controller
    setExporting(true)
    setExportFormat(format)
    setExportError(null)
    try {
      const blob =
        format === "csv"
          ? await downloadReportDetails(body, controller.signal)
          : await downloadReportFile(
              {
                config,
                card_id: card.id,
                point,
                format: "xlsx",
                data: "details",
                selection_scope: scope,
                sort_by: sortBy,
                sort_direction: direction,
              },
              controller.signal
            )
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = detailCsvFilename(card.title).replace(
        /\.csv$/,
        `.${format}`
      )
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      if (!controller.signal.aborted)
        setExportError(
          error instanceof Error ? error.message : "匯出失敗，請再試一次"
        )
    } finally {
      if (!controller.signal.aborted) setExporting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[92dvh] min-w-0 flex-col gap-3 overflow-hidden rounded-xl border p-4 shadow-xl sm:max-w-6xl">
        <DialogHeader className="min-w-0 pr-5 text-left">
          <DialogTitle className="wrap-break-word">
            {card.title} · 逐筆明細
          </DialogTitle>
          <DialogDescription className="wrap-break-word">
            {point ? `資料點：${point.label}` : "目前圖表範圍內的實際資料列"}。
            {snapshot
              ? "目前快照，不產生歷史。"
              : "套用報表、分頁、單圖與聯動條件。"}
          </DialogDescription>
        </DialogHeader>
        {hasHighlight && (
          <label className="space-y-1 text-xs">
            醒目提示明細範圍
            <NativeSelect
              aria-label="醒目提示明細範圍"
              disabled={exporting}
              value={scope}
              className="h-10 rounded-md border text-sm shadow-none"
              onChange={(event) => {
                setScope(event.target.value as typeof scope)
                setPage(1)
              }}
            >
              <option value="chart">完整圖表範圍</option>
              <option value="selected">聯動選取的子集</option>
            </NativeSelect>
          </label>
        )}
        <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <label className="col-span-2 min-w-0 space-y-1 text-xs sm:flex-1">
            排序欄位
            <NativeSelect
              aria-label="明細排序欄位"
              value={sortBy}
              disabled={!columns.length || exporting}
              className="h-10 rounded-md border text-xs shadow-none"
              onChange={(event) => {
                setSortBy(event.target.value as typeof sortBy)
                setPage(1)
              }}
            >
              {!columns.length && <option value={sortBy}>正在載入…</option>}
              {columns
                .filter((column) => column.sort_key)
                .map((column) => (
                  <option key={column.key} value={column.sort_key!}>
                    {column.label}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-xs">
            順序
            <NativeSelect
              aria-label="明細排序順序"
              disabled={exporting}
              value={direction}
              className="h-10 rounded-md border text-xs shadow-none"
              onChange={(event) => {
                setDirection(event.target.value as typeof direction)
                setPage(1)
              }}
            >
              <option value="desc">由大到小</option>
              <option value="asc">由小到大</option>
            </NativeSelect>
          </label>
          <Button
            variant="outline"
            className="h-10 rounded-md shadow-none"
            disabled={!data || exporting}
            onClick={() => void exportDetails("csv")}
          >
            {exporting && exportFormat === "csv" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            完整 CSV
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-md shadow-none"
            disabled={!data || exporting}
            onClick={() => void exportDetails("xlsx")}
          >
            {exporting && exportFormat === "xlsx" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            完整 Excel
          </Button>
        </div>
        {data && (
          <div className="space-y-1 text-xs" aria-live="polite">
            <p>
              共 {data.total_rows.toLocaleString("zh-TW")} 筆 ·{" "}
              {METRICS[card.metric].label}：
              {formatReportExactValue(data.total, card.metric)}
            </p>
            <p className="text-muted-foreground">
              {snapshot
                ? `快照基準日：${data.as_of}`
                : data.start > data.end
                  ? "日期條件沒有交集"
                  : `交易／拜訪日期：${data.start} 至 ${data.end}`}{" "}
              · CSV／Excel 匯出全部符合條件的資料，不受目前頁碼限制。
            </p>
            <p className="text-muted-foreground">{data.note}</p>
          </div>
        )}
        {exportError && (
          <p role="alert" className="text-xs text-destructive">
            {exportError}
          </p>
        )}
        {error ? (
          <div className="space-y-2 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重新載入明細
            </Button>
          </div>
        ) : !data ? (
          <p
            role="status"
            className="py-10 text-center text-sm text-muted-foreground"
          >
            正在載入明細…
          </p>
        ) : (
          <div
            className="min-h-0 min-w-0 overflow-auto rounded-md border"
            aria-label="逐筆明細表格"
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {data.columns.map((column) => (
                    <th
                      key={column.key}
                      className="px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    {data.columns.map((column) => (
                      <td
                        key={column.key}
                        className="px-3 py-2 align-top whitespace-nowrap"
                      >
                        {detailValue(column, row.values[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="p-6 text-center text-muted-foreground">
                此範圍沒有符合條件的資料。
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
          <label className="flex items-center gap-2">
            每頁
            <NativeSelect
              aria-label="明細每頁筆數"
              disabled={exporting}
              value={pageSize}
              className="h-10 w-20 rounded-md border text-xs shadow-none"
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-md px-3 shadow-none"
              disabled={!data || page <= 1 || exporting}
              onClick={() => setPage((value) => value - 1)}
            >
              上一頁
            </Button>
            <span>
              {page} / {data ? pages : "…"}
            </span>
            <Button
              variant="outline"
              className="h-10 rounded-md px-3 shadow-none"
              disabled={!data || page >= pages || exporting}
              onClick={() => setPage((value) => value + 1)}
            >
              下一頁
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
