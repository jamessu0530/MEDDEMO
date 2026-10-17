import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Database,
  Download,
  LoaderCircle,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "@/components/icons"
import {
  analyzeDataSource,
  deleteDataSource,
  exportDataSource,
  getDataSource,
  importDataFile,
  inspectDataFile,
  listDataSources,
  mergeDataSources,
  previewDataRecipe,
  reparseDataSource,
  saveDataSource,
  type DataAnalysis,
  type DataChart,
  type DataDetail,
  type DataInspection,
  type DataPreview,
  type DataRecipe,
  type DataSource,
} from "@/api/report-datasets"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DatasetChart } from "@/components/reports/dataset-chart"
import {
  chartCompatible,
  DATA_AGGREGATIONS,
  DATA_KINDS,
  DATA_VISUALS,
  dataDirty,
  dataValue,
  defaultDataChart,
  suggestedDataRecipe,
} from "@/lib/report-datasets"

const INPUT =
  "min-h-10 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm"
type Tab = "preview" | "clean" | "merge" | "ai" | "charts"
const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "資料預覽" },
  { id: "clean", label: "欄位整理" },
  { id: "merge", label: "合併資料" },
  { id: "ai", label: "AI 看檔案" },
  { id: "charts", label: "分析報表" },
]

export function ReportDatasetLauncher({
  onClose,
}: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        className="h-10 rounded-md shadow-none"
        onClick={() => setOpen(true)}
      >
        <Database className="size-4" />
        資料匯入
      </Button>
      {open && (
        <DatasetWorkspace
          onClose={() => {
            setOpen(false)
            onClose?.()
          }}
        />
      )}
    </>
  )
}

function DatasetWorkspace({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<DataSource[]>([])
  const [source, setSource] = useState<DataDetail | null>(null)
  const [recipe, setRecipe] = useState<DataRecipe | null>(null)
  const [name, setName] = useState("")
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [previewKey, setPreviewKey] = useState("")
  const [tab, setTab] = useState<Tab>("preview")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [analysis, setAnalysis] = useState<DataAnalysis | null>(null)
  const [question, setQuestion] = useState(
    "請幫我看這份檔案在記錄什麼、欄位代表什麼、有沒有需要整理的地方，以及適合做哪些報表。"
  )
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<null | {
    label: string
    run: () => void
    reset?: boolean
  }>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [headerRow, setHeaderRow] = useState(1)
  const [encoding, setEncoding] = useState("auto")
  const [delimiter, setDelimiter] = useState("auto")
  const [sheet, setSheet] = useState("")
  const [stagedFile, setStagedFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<DataInspection | null>(null)
  const [fileSheet, setFileSheet] = useState("")
  const [inspectionKey, setInspectionKey] = useState("")
  const fileOptionsKey = JSON.stringify({
    sheet: fileSheet,
    header_row: headerRow,
    encoding,
    delimiter,
  })
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const dirty = !!source && !!recipe && dataDirty(source, recipe, name)
  const recipeKey = JSON.stringify(recipe)
  const previewCurrent = previewKey === recipeKey
  const analyzedCurrent = source && analysis?.revision === source.revision

  useEffect(() => {
    alive.current = true
    const abort = new AbortController()
    listDataSources(abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return
        setSources(result.datasets)
        setAiAvailable(result.ai_available)
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "資料來源暫時無法載入"
          )
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => {
      alive.current = false
      abort.abort()
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function accept(next: DataDetail) {
    setSource(next)
    setRecipe(structuredClone(next.recipe))
    setName(next.name)
    setPreview(null)
    setPreviewKey("")
    setAnalysis(null)
    setSheet(next.origin.sheet ?? "")
    setHeaderRow(next.origin.header_row ?? 1)
    setEncoding(next.origin.encoding ?? "auto")
    setDelimiter(next.origin.delimiter ?? "auto")
    setSources((current) => [
      next,
      ...current.filter((item) => item.id !== next.id),
    ])
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await action()
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "操作未完成，請重試"
        )
    } finally {
      setBusy(false)
    }
  }
  function guard(label: string, action: () => void, reset = false) {
    if (busy) return
    if (dirty || reset) setPending({ label, run: action, reset })
    else action()
  }
  function open(id: string) {
    if (id === source?.id) return
    guard("切換資料來源", () => {
      void run(async () => {
        const next = await getDataSource(id)
        if (alive.current) {
          accept(next)
          setTab("preview")
        }
      })
    })
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError("單一檔案最多 10MB，請拆分後上傳。")
      return
    }
    if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) {
      setError("請選擇 .xlsx、.csv 或 .tsv 檔案。")
      return
    }
    await run(async () => {
      const abort = new AbortController()
      controller.current = abort
      const next = await inspectDataFile(
        file,
        { header_row: headerRow, encoding, delimiter },
        abort.signal
      )
      if (alive.current) {
        setStagedFile(file)
        setInspection(next)
        setFileSheet(next.origin.sheet ?? "")
        setInspectionKey(
          JSON.stringify({
            sheet: next.origin.sheet ?? "",
            header_row: headerRow,
            encoding,
            delimiter,
          })
        )
        setMessage("讀檔完成，請確認預覽與工作表，再按「確認匯入」。")
      }
    })
  }
  async function inspectAgain() {
    if (!stagedFile) return
    await run(async () => {
      const next = await inspectDataFile(stagedFile, {
        sheet: fileSheet || undefined,
        header_row: headerRow,
        encoding,
        delimiter,
      })
      if (alive.current) {
        setInspection(next)
        setInspectionKey(fileOptionsKey)
      }
    })
  }
  async function confirmImport() {
    if (!stagedFile || !inspection?.preview || inspectionKey !== fileOptionsKey)
      return
    await run(async () => {
      const next = await importDataFile(stagedFile, {
        sheet: fileSheet || undefined,
        header_row: headerRow,
        encoding,
        delimiter,
      })
      if (alive.current) {
        accept(next)
        setStagedFile(null)
        setInspection(null)
        setTab("preview")
        setMessage("資料已匯入，可整理欄位、建立圖表，或請 AI 判讀。")
      }
    })
  }
  async function saveClean() {
    if (!source || !recipe) return
    await run(async () => {
      const columns = recipe.columns.filter((column) => column.include)
      const incompatible = source.charts.filter(
        (chart) => !chartCompatible(chart, columns)
      )
      if (incompatible.length)
        throw new Error(
          `「${incompatible[0].title}」使用的欄位會被移除或改變型別，請先在分析報表移除這張圖表。`
        )
      const next = await saveDataSource({ ...source, name }, recipe)
      if (alive.current) {
        accept(next)
        setMessage("整理結果與報表已儲存，原始資料仍保留，可隨時重新整理。")
      }
    })
  }
  async function saveCharts(charts: DataChart[]) {
    if (!source) return
    await run(async () => {
      const next = await saveDataSource(source, source.recipe, charts)
      if (alive.current) {
        accept(next)
        if (analysis?.revision === source.revision)
          setAnalysis({ ...analysis, revision: next.revision })
        setTab("charts")
        setMessage("分析圖表已儲存到這份資料來源。")
      }
    })
  }
  function close() {
    guard("關閉資料匯入", onClose)
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          className="flex h-[94dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
          onInteractOutside={(event) => {
            if (busy || dirty) event.preventDefault()
          }}
        >
          <DialogHeader className="shrink-0 border-b p-4 pr-10">
            <DialogTitle className="flex items-center gap-2">
              <Database className="size-5 text-primary" />
              匯入資料與 AI 分析
            </DialogTitle>
            <DialogDescription>資料僅供目前登入帳號使用。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
            <div className="mb-4 space-y-3 rounded-xl border bg-muted/20 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={`我的資料來源（${sources.length}／20）`}>
                  <select
                    className={INPUT}
                    aria-label="匯入資料來源"
                    disabled={busy || loading}
                    value={source?.id ?? ""}
                    onChange={(event) => open(event.target.value)}
                  >
                    <option value="">
                      {loading ? "正在載入…" : "選擇資料來源"}
                    </option>
                    {sources.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.row_count.toLocaleString()} 列
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  disabled={busy || loading || sources.length >= 20}
                  onClick={() =>
                    guard("匯入新檔案", () => input.current?.click())
                  }
                >
                  <Upload className="size-4" />
                  上傳檔案
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept=".xlsx,.csv,.tsv"
                  className="sr-only"
                  aria-label="上傳報表資料檔案"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ""
                    if (file) void upload(file)
                  }}
                />
              </div>
              <details className="text-xs">
                <summary className="min-h-8 cursor-pointer text-muted-foreground">
                  讀檔選項：標題列、文字編碼、分隔符號
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Field label="標題列">
                    <input
                      className={INPUT}
                      type="number"
                      min={1}
                      max={100}
                      aria-label="檔案標題列"
                      value={headerRow}
                      disabled={busy}
                      onChange={(event) =>
                        setHeaderRow(Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="CSV／TSV 編碼">
                    <select
                      className={INPUT}
                      value={encoding}
                      disabled={busy}
                      aria-label="檔案文字編碼"
                      onChange={(event) => setEncoding(event.target.value)}
                    >
                      <option value="auto">自動偵測</option>
                      <option value="utf-8-sig">UTF-8</option>
                      <option value="utf-16">UTF-16</option>
                      <option value="cp950">Big5／CP950</option>
                    </select>
                  </Field>
                  <Field label="分隔符號">
                    <select
                      className={INPUT}
                      value={delimiter}
                      disabled={busy}
                      aria-label="檔案分隔符號"
                      onChange={(event) => setDelimiter(event.target.value)}
                    >
                      <option value="auto">自動偵測</option>
                      <option value=",">逗號</option>
                      <option value={"\t"}>Tab</option>
                      <option value=";">分號</option>
                      <option value="|">直線</option>
                    </select>
                  </Field>
                </div>
                {source && !source.origin.sources && (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      guard(
                        "重新讀取原檔並清除既有圖表",
                        () =>
                          void run(async () => {
                            const next = await reparseDataSource(source.id, {
                              revision: source.revision,
                              sheet: sheet || null,
                              header_row: headerRow,
                              encoding,
                              delimiter,
                            })
                            if (alive.current) {
                              accept(next)
                              setTab("preview")
                              setMessage(
                                "已重新讀取原檔，既有圖表與整理設定已重設。"
                              )
                            }
                          }),
                        true
                      )
                    }
                  >
                    依目前選項重新讀檔（會重設此資料的圖表）
                  </Button>
                )}
              </details>
              <p className="text-xs text-muted-foreground">
                Excel .xlsx／CSV／TSV · 每檔 10MB、最多 20,000 列、100 欄與
                500,000 格。
              </p>
            </div>
            {busy && (
              <p role="status" className="mb-3 flex items-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin" />
                正在處理，請稍候…
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="mb-3 rounded-lg bg-primary/10 p-3 text-sm"
              >
                {message}
              </p>
            )}
            {stagedFile && inspection && (
              <section className="mb-4 space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium">
                  匯入前預覽：{stagedFile.name}
                </p>
                {inspection.origin.sheets.length > 0 && (
                  <Field label="要匯入的 Excel 工作表">
                    <select
                      className={INPUT}
                      aria-label="匯入前工作表"
                      value={fileSheet}
                      disabled={busy}
                      onChange={(event) => setFileSheet(event.target.value)}
                    >
                      {inspection.origin.sheets.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </Field>
                )}
                {inspection.error && (
                  <p className="text-xs text-amber-700">
                    {inspection.error} 可調整工作表或上方的標題列，再重新預覽。
                  </p>
                )}
                {inspectionKey !== fileOptionsKey && (
                  <p className="text-xs text-amber-700">
                    讀檔選項已變更，請重新預覽後匯入。
                  </p>
                )}
                {inspection.preview && (
                  <>
                    <p className="text-xs">
                      讀取 {inspection.preview.row_count.toLocaleString()} 列 ×{" "}
                      {inspection.preview.columns.length} 欄；先顯示前 50 列。
                    </p>
                    <DataTable preview={inspection.preview} />
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void inspectAgain()}
                  >
                    重新預覽檔案
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      !inspection.preview ||
                      inspectionKey !== fileOptionsKey
                    }
                    onClick={() => void confirmImport()}
                  >
                    確認匯入
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setStagedFile(null)
                      setInspection(null)
                    }}
                  >
                    取消匯入
                  </Button>
                </div>
              </section>
            )}
            {!source && !stagedFile && !loading && (
              <div className="rounded-xl border border-dashed px-4 py-10 text-center">
                <Upload className="mx-auto mb-3 size-9 text-primary" />
                <p className="font-medium">尚未匯入資料</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  選擇 Excel、CSV 或 TSV 開始分析。
                </p>
              </div>
            )}
            {source && recipe && (
              <>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <Field label="資料名稱">
                    <input
                      className={INPUT}
                      aria-label="匯入資料名稱"
                      value={name}
                      maxLength={80}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  {source.origin.sheets.length > 0 && (
                    <Field label="Excel 工作表">
                      <select
                        className={INPUT}
                        aria-label="Excel 工作表"
                        disabled={busy}
                        value={sheet}
                        onChange={(event) => {
                          const selected = event.target.value
                          guard(
                            "切換工作表並重設圖表與整理設定",
                            () =>
                              void run(async () => {
                                const next = await reparseDataSource(
                                  source.id,
                                  {
                                    revision: source.revision,
                                    sheet: selected,
                                    header_row: headerRow,
                                    encoding,
                                    delimiter,
                                  }
                                )
                                if (alive.current) {
                                  accept(next)
                                  setTab("preview")
                                }
                              }),
                            true
                          )
                        }}
                      >
                        {source.origin.sheets.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      guard(
                        "重新載入已儲存版本",
                        () =>
                          void run(async () => {
                            const next = await getDataSource(source.id)
                            if (alive.current) accept(next)
                          })
                      )
                    }
                  >
                    重新載入
                  </Button>
                  <Button
                    disabled={busy || !dirty || !name.trim()}
                    onClick={() => void saveClean()}
                  >
                    <Save className="size-4" />
                    儲存整理
                  </Button>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  {source.origin.filename}
                  {source.origin.sheet && ` · ${source.origin.sheet}`} ·{" "}
                  {source.row_count.toLocaleString()} 列 ×{" "}
                  {source.columns.length} 欄 · 版本 {source.revision}
                  {dirty && " · 尚未儲存整理"}
                </p>
                {source.origin.warnings.map((warning) => (
                  <p
                    key={warning}
                    className="mb-2 text-xs leading-relaxed text-muted-foreground"
                  >
                    {warning}
                  </p>
                ))}
                {source.origin.sources && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    合併來源：
                    {source.origin.sources
                      .map((item) => `${item.name}（版本 ${item.revision}）`)
                      .join(" ＋ ")}
                  </p>
                )}
                <div
                  role="tablist"
                  aria-label="匯入資料工具"
                  className="mb-4 flex overflow-x-auto border-b"
                >
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`dataset-tab-${item.id}`}
                      aria-controls={`dataset-panel-${item.id}`}
                      aria-selected={tab === item.id}
                      tabIndex={tab === item.id ? 0 : -1}
                      onKeyDown={(event) => {
                        if (
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key
                          )
                        )
                          return
                        event.preventDefault()
                        const index = TABS.findIndex(
                          (candidate) => candidate.id === tab
                        )
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? TABS.length - 1
                              : (index +
                                  (event.key === "ArrowRight" ? 1 : -1) +
                                  TABS.length) %
                                TABS.length
                        setTab(TABS[next].id)
                        document
                          .getElementById(`dataset-tab-${TABS[next].id}`)
                          ?.focus()
                      }}
                      className={`min-h-11 shrink-0 border-b-2 px-3 text-sm ${tab === item.id ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"}`}
                      onClick={() => setTab(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id={`dataset-panel-${tab}`}
                  aria-labelledby={`dataset-tab-${tab}`}
                >
                  {tab === "preview" && (
                    <>
                      <DataTable preview={source.preview} />
                      <div className="mt-3 flex items-center gap-2 text-xs">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || source.preview.page <= 1}
                          onClick={() =>
                            void run(async () => {
                              const next = await getDataSource(
                                source.id,
                                source.preview.page - 1
                              )
                              if (alive.current) setSource(next)
                            })
                          }
                        >
                          上一頁
                        </Button>
                        <span>
                          第 {source.preview.page}／
                          {Math.max(1, Math.ceil(source.row_count / 50))} 頁
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            busy || source.preview.page * 50 >= source.row_count
                          }
                          onClick={() =>
                            void run(async () => {
                              const next = await getDataSource(
                                source.id,
                                source.preview.page + 1
                              )
                              if (alive.current) setSource(next)
                            })
                          }
                        >
                          下一頁
                        </Button>
                      </div>
                      <ProfileTable preview={source.preview} />
                    </>
                  )}
                  {tab === "clean" && (
                    <div className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        修改後先預覽再儲存。識別碼會保留前導零。
                      </p>
                      <div className="max-h-80 overflow-auto rounded-lg border">
                        <table className="w-full min-w-[520px] text-xs">
                          <thead className="sticky top-0 bg-muted">
                            <tr>
                              <th className="p-2">保留</th>
                              <th className="p-2 text-left">原始欄名</th>
                              <th className="p-2 text-left">顯示欄名</th>
                              <th className="p-2 text-left">資料型別</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recipe.columns.map((column) => (
                              <tr key={column.id} className="border-t">
                                <td className="p-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={column.include}
                                    aria-label={`保留欄位 ${column.name}`}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setRecipe({
                                        ...recipe,
                                        columns: recipe.columns.map((item) =>
                                          item.id === column.id
                                            ? {
                                                ...item,
                                                include: event.target.checked,
                                              }
                                            : item
                                        ),
                                      })
                                    }
                                  />
                                </td>
                                <td className="max-w-40 truncate p-2">
                                  {
                                    source.source_columns.find(
                                      (item) => item.id === column.id
                                    )?.name
                                  }
                                </td>
                                <td className="p-2">
                                  <input
                                    className={INPUT}
                                    aria-label={`欄位名稱 ${column.id}`}
                                    maxLength={80}
                                    value={column.name}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setRecipe({
                                        ...recipe,
                                        columns: recipe.columns.map((item) =>
                                          item.id === column.id
                                            ? {
                                                ...item,
                                                name: event.target.value,
                                              }
                                            : item
                                        ),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <select
                                    className={INPUT}
                                    aria-label={`欄位型別 ${column.name}`}
                                    value={column.kind}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setRecipe({
                                        ...recipe,
                                        columns: recipe.columns.map((item) =>
                                          item.id === column.id
                                            ? {
                                                ...item,
                                                kind: event.target
                                                  .value as typeof item.kind,
                                              }
                                            : item
                                        ),
                                      })
                                    }
                                  >
                                    {Object.entries(DATA_KINDS).map(
                                      ([key, label]) => (
                                        <option key={key} value={key}>
                                          {label}
                                        </option>
                                      )
                                    )}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        {(
                          [
                            ["trim", "移除文字前後空白"],
                            ["drop_blank", "移除全空白列"],
                            ["deduplicate", "移除重複列（依保留欄位）"],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="flex min-h-9 items-center gap-2"
                          >
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={recipe[key]}
                              onChange={(event) =>
                                setRecipe({
                                  ...recipe,
                                  [key]: event.target.checked,
                                })
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <Field label="無法轉換的儲存格">
                        <select
                          className={INPUT}
                          value={recipe.invalid}
                          aria-label="型別轉換錯誤處理"
                          disabled={busy}
                          onChange={(event) =>
                            setRecipe({
                              ...recipe,
                              invalid: event.target
                                .value as DataRecipe["invalid"],
                            })
                          }
                        >
                          <option value="reject">阻止儲存，先檢查錯誤</option>
                          <option value="null">
                            明確將無法轉換的值設為空白
                          </option>
                        </select>
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const next = await previewDataRecipe(
                                source.id,
                                recipe
                              )
                              if (alive.current) {
                                setPreview(next)
                                setPreviewKey(recipeKey)
                              }
                            })
                          }
                        >
                          預覽整理結果
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setRecipe(structuredClone(source.recipe))
                            setName(source.name)
                            setPreview(null)
                          }}
                        >
                          還原已儲存設定
                        </Button>
                      </div>
                      {preview && (
                        <>
                          <p className="text-xs">
                            {!previewCurrent &&
                              "設定已變更，以下是上次預覽；請重新預覽。"}
                            結果 {preview.row_count.toLocaleString()}{" "}
                            列；移除空白 {preview.changes?.removed_blank}{" "}
                            列、重複 {preview.changes?.removed_duplicates}{" "}
                            列、轉換錯誤 {preview.changes?.invalid_cells} 格。
                          </p>
                          {!!preview.changes?.invalid_cells && (
                            <div className="rounded border border-amber-400 p-3 text-xs">
                              <p>
                                {preview.changes.can_save
                                  ? "錯誤值將依你的設定改為空白。"
                                  : "存在轉換錯誤，目前不能儲存。"}
                              </p>
                              {preview.changes.issues.map((item, index) => (
                                <p key={index} className="mt-1 break-words">
                                  資料列 {item.row} · {item.column}：「
                                  {item.value}」
                                </p>
                              ))}
                            </div>
                          )}
                          <DataTable preview={preview} />
                        </>
                      )}
                    </div>
                  )}
                  {tab === "merge" && (
                    <MergePanel
                      source={source}
                      sources={sources}
                      busy={busy}
                      onMerge={(body) =>
                        guard(
                          "建立合併資料",
                          () =>
                            void run(async () => {
                              const next = await mergeDataSources(body)
                              if (alive.current) {
                                accept(next)
                                setTab("preview")
                                setMessage(
                                  "合併結果已另存為新資料來源，兩份原資料仍保留。"
                                )
                              }
                            })
                        )
                      }
                    />
                  )}
                  {tab === "ai" && (
                    <div className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        AI 會讀取已儲存資料的欄位、全表統計與最多 60
                        列分散取樣；可請它解釋內容、找資料品質問題或建議報表。整理草稿請先儲存。
                      </p>
                      <label className="block space-y-2 text-sm">
                        <span>想請 AI 看什麼？</span>
                        <textarea
                          className={`${INPUT} min-h-24 py-2`}
                          aria-label="AI 檔案判讀問題"
                          value={question}
                          maxLength={1000}
                          disabled={busy}
                          onChange={(event) => setQuestion(event.target.value)}
                        />
                      </label>
                      <Button
                        disabled={
                          busy || dirty || !question.trim() || !aiAvailable
                        }
                        onClick={() =>
                          void run(async () => {
                            const abort = new AbortController()
                            controller.current = abort
                            const next = await analyzeDataSource(
                              source.id,
                              question,
                              abort.signal
                            )
                            if (alive.current) setAnalysis(next)
                          })
                        }
                      >
                        <Sparkles className="size-4" />
                        {aiAvailable ? "請 AI 看這份檔案" : "AI 尚未設定"}
                      </Button>
                      {!aiAvailable && (
                        <p className="text-xs text-muted-foreground">
                          完成雲端 AI
                          設定後即可判讀檔案；資料預覽、整理與圖表已可使用。
                        </p>
                      )}
                      {dirty && (
                        <p className="text-xs text-amber-700">
                          請先儲存整理，讓 AI 判讀你確認過的版本。
                        </p>
                      )}
                      {analysis && (
                        <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                          <p className="text-xs text-muted-foreground">
                            分析版本 {analysis.revision} · 統計涵蓋{" "}
                            {analysis.total_rows.toLocaleString()} 列 · AI 取樣{" "}
                            {analysis.sample_rows} 列
                          </p>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {analysis.summary}
                          </p>
                          {analysis.findings.length > 0 && (
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {analysis.findings.map((item, index) => (
                                <li key={index}>{item}</li>
                              ))}
                            </ul>
                          )}
                          {analysis.cautions.map((item, index) => (
                            <p key={index} className="text-xs text-amber-700">
                              {item}
                            </p>
                          ))}
                          {analysis.columns.length > 0 && (
                            <div className="space-y-2 border-t pt-3">
                              <p className="text-sm font-medium">
                                欄位整理建議
                              </p>
                              {analysis.columns.map((item) => (
                                <p
                                  key={item.id}
                                  className="text-xs leading-relaxed"
                                >
                                  {
                                    source.columns.find(
                                      (column) => column.id === item.id
                                    )?.name
                                  }{" "}
                                  → {item.name}（{DATA_KINDS[item.kind]}）：
                                  {item.reason}
                                </p>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy || !analyzedCurrent}
                                onClick={() => {
                                  setRecipe(
                                    suggestedDataRecipe(recipe, analysis)
                                  )
                                  setTab("clean")
                                  setPreview(null)
                                  setMessage(
                                    "AI 建議已放入整理草稿，請預覽並確認後儲存。"
                                  )
                                }}
                              >
                                放入整理草稿並檢查
                              </Button>
                            </div>
                          )}
                          {analysis.charts.length > 0 && (
                            <div className="space-y-2 border-t pt-3">
                              <p className="text-sm font-medium">建議圖表</p>
                              {analysis.charts.map((chart, index) => (
                                <div
                                  key={index}
                                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                >
                                  <span>
                                    {chart.title} · {DATA_VISUALS[chart.visual]}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      busy ||
                                      !analyzedCurrent ||
                                      dirty ||
                                      source.charts.length >= 8
                                    }
                                    onClick={() =>
                                      void saveCharts([
                                        ...source.charts,
                                        {
                                          ...chart,
                                          id: `chart-${crypto.randomUUID().slice(0, 12)}`,
                                        },
                                      ])
                                    }
                                  >
                                    <Plus className="size-3.5" />
                                    加入分析報表
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {tab === "charts" && (
                    <DatasetReports
                      key={`${source.id}/${source.revision}`}
                      source={source}
                      busy={busy || dirty}
                      onSave={(charts) => void saveCharts(charts)}
                    />
                  )}
                </div>
                <div className="mt-6 flex flex-wrap justify-between gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const blob = await exportDataSource(source.id)
                        if (!alive.current) return
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement("a")
                        link.href = url
                        link.download = `${source.name.replace(/[\\/:*?"<>|]/g, "_")}.csv`
                        link.click()
                        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
                      })
                    }
                  >
                    <Download className="size-4" />
                    匯出已整理的完整 CSV
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    刪除資料來源
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.reset ? "重新讀取原始檔案？" : "還有未儲存的整理"}
            </DialogTitle>
            <DialogDescription>
              {pending?.reset
                ? `「${name}」的圖表與整理設定會重設，並依目前選項重新讀取原檔。若要保留這份整理結果，請取消並重新匯入另一份資料。`
                : `「${name}」的整理設定尚未儲存。要先捨棄草稿，再${pending?.label}嗎？已儲存的資料仍會保留。`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              繼續整理
            </Button>
            <Button
              onClick={() => {
                const next = pending
                setPending(null)
                setRecipe(source ? structuredClone(source.recipe) : null)
                setName(source?.name ?? "")
                next?.run()
              }}
            >
              {pending?.reset ? "確認重新讀取" : "捨棄草稿後繼續"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>刪除「{source?.name}」？</DialogTitle>
            <DialogDescription>
              會一併刪除這份匯入原檔、整理資料及分析圖表。已另存的合併資料仍會保留。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!source) return
                void run(async () => {
                  await deleteDataSource(source)
                  if (alive.current) {
                    setSources((current) =>
                      current.filter((item) => item.id !== source.id)
                    )
                    setSource(null)
                    setRecipe(null)
                    setDeleteOpen(false)
                    setAnalysis(null)
                  }
                })
              }}
            >
              刪除資料來源
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 flex-[1_1_12rem] space-y-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function DataTable({ preview }: { preview: DataPreview }) {
  return (
    <div className="max-h-80 max-w-full overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="min-w-12 p-2 text-left">列</th>
            {preview.columns.map((column) => (
              <th key={column.id} className="min-w-32 p-2 text-left">
                <span className="block max-w-52 truncate" title={column.name}>
                  {column.name}
                </span>
                <span className="font-normal text-muted-foreground">
                  {DATA_KINDS[column.kind]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, index) => (
            <tr key={index} className="border-t">
              <td className="p-2 text-muted-foreground">
                {(preview.page - 1) * preview.page_size + index + 1}
              </td>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className="max-w-64 truncate p-2"
                  title={cell === null ? "空白" : String(cell)}
                >
                  {dataValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!preview.rows.length && (
        <p className="p-5 text-center text-xs text-muted-foreground">
          沒有資料列。
        </p>
      )}
    </div>
  )
}

export function ProfileTable({ preview }: { preview: DataPreview }) {
  return (
    <details className="mt-4 rounded-lg border p-3" open>
      <summary className="min-h-8 cursor-pointer text-sm font-medium">
        全表欄位統計（{preview.row_count.toLocaleString()} 列）
      </summary>
      <div className="max-h-72 overflow-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr>
              {["欄位", "空白", "不同值", "合計", "平均", "範例"].map(
                (label) => (
                  <th key={label} className="p-2 text-left">
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {preview.profiles.map((column) => (
              <tr key={column.id} className="border-t">
                <td className="p-2">{column.name}</td>
                <td className="p-2">{column.empty}</td>
                <td className="p-2">{column.distinct}</td>
                <td className="p-2">{dataValue(column.sum)}</td>
                <td className="p-2">{dataValue(column.average)}</td>
                <td className="max-w-64 truncate p-2">
                  {column.examples.join("、")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function MergePanel({
  source,
  sources,
  busy,
  onMerge,
}: {
  source: DataSource
  sources: DataSource[]
  busy: boolean
  onMerge: (body: Parameters<typeof mergeDataSources>[0]) => void
}) {
  const [rightId, setRightId] = useState("")
  const [mode, setMode] = useState<"append" | "left_join">("append")
  const [leftKey, setLeftKey] = useState(source.columns[0]?.id ?? "")
  const [rightKey, setRightKey] = useState("")
  const [name, setName] = useState(`${source.name.slice(0, 65)} 合併`)
  const right = sources.find((item) => item.id === rightId)
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        合併後另存為新資料。「往下附加」依欄名對齊；「依欄位對應」保留左側資料，右側鍵值須唯一。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="右側資料來源">
          <select
            className={INPUT}
            aria-label="合併右側資料"
            value={rightId}
            disabled={busy}
            onChange={(event) => {
              setRightId(event.target.value)
              setRightKey(
                sources.find((item) => item.id === event.target.value)
                  ?.columns[0]?.id ?? ""
              )
            }}
          >
            <option value="">選擇另一份資料</option>
            {sources
              .filter((item) => item.id !== source.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="合併方式">
          <select
            className={INPUT}
            value={mode}
            disabled={busy}
            aria-label="合併方式"
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="append">往下附加資料列</option>
            <option value="left_join">依欄位對應（左側合併）</option>
          </select>
        </Field>
        {mode === "left_join" && (
          <>
            <Field label="左側對應欄位">
              <select
                className={INPUT}
                value={leftKey}
                disabled={busy}
                onChange={(event) => setLeftKey(event.target.value)}
              >
                {source.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="右側對應欄位">
              <select
                className={INPUT}
                value={rightKey}
                disabled={busy}
                onChange={(event) => setRightKey(event.target.value)}
              >
                {right?.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label="合併後的資料名稱">
          <input
            className={INPUT}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>
      <Button
        disabled={busy || !right || !name.trim() || sources.length >= 20}
        onClick={() => {
          if (right)
            onMerge({
              left_id: source.id,
              right_id: right.id,
              left_revision: source.revision,
              right_revision: right.revision,
              name,
              mode,
              left_key: leftKey || null,
              right_key: rightKey || null,
            })
        }}
      >
        建立合併資料
      </Button>
      {sources.length < 2 && (
        <p className="text-xs text-muted-foreground">
          先上傳第二份檔案，即可合併。
        </p>
      )}
    </div>
  )
}

function DatasetReports({
  source,
  busy,
  onSave,
}: {
  source: DataSource
  busy: boolean
  onSave: (charts: DataChart[]) => void
}) {
  const [chart, setChart] = useState<DataChart>(() =>
    defaultDataChart(source.columns)
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const numbers = source.columns.filter((column) => column.kind === "number")
  function patch(value: Partial<DataChart>) {
    setChart((current) => ({ ...current, ...value }))
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        每份資料最多 8 張圖表，依完整資料計算。
        {busy && " 請先儲存或還原欄位整理。"}
      </p>
      <fieldset
        disabled={busy}
        className="space-y-3 rounded-xl border bg-muted/20 p-3"
      >
        <legend className="px-1 text-sm font-medium">
          {editingId ? "編輯圖表" : "新增圖表"}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="圖表標題">
            <input
              className={INPUT}
              value={chart.title}
              maxLength={80}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label="圖表類型">
            <select
              className={INPUT}
              aria-label="匯入圖表類型"
              value={chart.visual}
              onChange={(event) =>
                patch({ visual: event.target.value as DataChart["visual"] })
              }
            >
              {Object.entries(DATA_VISUALS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="分組欄位">
            <select
              className={INPUT}
              aria-label="匯入圖表分組"
              disabled={chart.visual === "kpi"}
              value={chart.group_by ?? ""}
              onChange={(event) =>
                patch({ group_by: event.target.value || null })
              }
            >
              {chart.visual === "kpi" && <option value="">不分組</option>}
              {source.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="計算方式">
            <select
              className={INPUT}
              aria-label="匯入圖表計算方式"
              value={chart.aggregation}
              onChange={(event) => {
                const aggregation = event.target
                  .value as DataChart["aggregation"]
                patch({
                  aggregation,
                  value:
                    aggregation === "count"
                      ? null
                      : aggregation === "distinct"
                        ? (source.columns[0]?.id ?? null)
                        : (numbers[0]?.id ?? null),
                })
              }}
            >
              {Object.entries(DATA_AGGREGATIONS).map(([key, label]) => (
                <option
                  key={key}
                  value={key}
                  disabled={
                    !numbers.length &&
                    ["sum", "avg", "min", "max"].includes(key)
                  }
                >
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {chart.aggregation !== "count" && (
            <Field label="數值／計數欄位">
              <select
                className={INPUT}
                aria-label="匯入圖表數值欄位"
                value={chart.value ?? ""}
                onChange={(event) =>
                  patch({ value: event.target.value || null })
                }
              >
                {(chart.aggregation === "distinct"
                  ? source.columns
                  : numbers
                ).map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="排序">
            <select
              className={INPUT}
              value={chart.sort}
              onChange={(event) =>
                patch({ sort: event.target.value as DataChart["sort"] })
              }
            >
              <option value="value_desc">數值由大到小</option>
              <option value="value_asc">數值由小到大</option>
              <option value="label_asc">分組名稱／日期順序</option>
            </select>
          </Field>
          {source.columns.find((column) => column.id === chart.group_by)
            ?.kind === "date" && (
            <Field label="日期分組">
              <select
                className={INPUT}
                value={chart.date_grain}
                onChange={(event) =>
                  patch({
                    date_grain: event.target.value as DataChart["date_grain"],
                  })
                }
              >
                <option value="day">每日</option>
                <option value="month">每月</option>
                <option value="quarter">每季</option>
                <option value="year">每年</option>
              </select>
            </Field>
          )}
          <Field label="顯示分組數">
            <input
              className={INPUT}
              type="number"
              min={3}
              max={50}
              value={chart.limit}
              onChange={(event) => patch({ limit: Number(event.target.value) })}
            />
          </Field>
        </div>
        <details className="text-xs">
          <summary className="min-h-8 cursor-pointer">圖表篩選條件</summary>
          <div className="space-y-2">
            {chart.filters.map((filter, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <select
                  className={INPUT}
                  aria-label={`篩選欄位 ${index + 1}`}
                  value={filter.column}
                  onChange={(event) =>
                    patch({
                      filters: chart.filters.map((item, i) =>
                        i === index
                          ? { ...item, column: event.target.value }
                          : item
                      ),
                    })
                  }
                >
                  {source.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <select
                  className={INPUT}
                  aria-label={`篩選方式 ${index + 1}`}
                  value={filter.operator}
                  onChange={(event) =>
                    patch({
                      filters: chart.filters.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              operator: event.target
                                .value as typeof item.operator,
                            }
                          : item
                      ),
                    })
                  }
                >
                  <option value="eq">等於</option>
                  <option value="contains">包含文字</option>
                  <option value="gte">大於或等於</option>
                  <option value="lte">小於或等於</option>
                  <option value="not_empty">不是空白</option>
                </select>
                <input
                  className={INPUT}
                  aria-label={`篩選值 ${index + 1}`}
                  value={filter.value}
                  disabled={filter.operator === "not_empty"}
                  maxLength={200}
                  onChange={(event) =>
                    patch({
                      filters: chart.filters.map((item, i) =>
                        i === index
                          ? { ...item, value: event.target.value }
                          : item
                      ),
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    patch({
                      filters: chart.filters.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={chart.filters.length >= 8}
              onClick={() =>
                patch({
                  filters: [
                    ...chart.filters,
                    { column: source.columns[0].id, operator: "eq", value: "" },
                  ],
                })
              }
            >
              加入條件
            </Button>
          </div>
        </details>
        <Button
          disabled={
            busy ||
            !chart.title.trim() ||
            !Number.isInteger(chart.limit) ||
            chart.limit < 3 ||
            chart.limit > 50 ||
            (!editingId && source.charts.length >= 8)
          }
          onClick={() =>
            onSave(
              editingId
                ? source.charts.map((item) =>
                    item.id === editingId ? chart : item
                  )
                : [...source.charts, chart]
            )
          }
        >
          <Save className="size-4" />
          {editingId ? "儲存圖表" : "加入分析報表"}
        </Button>
        {editingId && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditingId(null)
              setChart(defaultDataChart(source.columns))
            }}
          >
            取消編輯
          </Button>
        )}
      </fieldset>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {source.charts.map((item) => (
          <article
            key={item.id}
            className="min-w-0 space-y-3 rounded-xl border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setChart(structuredClone(item))
                    setEditingId(item.id)
                  }}
                >
                  編輯
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`移除匯入圖表 ${item.title}`}
                  onClick={() =>
                    onSave(
                      source.charts.filter((chart) => chart.id !== item.id)
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {DATA_AGGREGATIONS[item.aggregation]}
              {item.value &&
                ` · ${source.columns.find((column) => column.id === item.value)?.name}`}
            </p>
            <DatasetChart source={source} chart={item} />
          </article>
        ))}
      </div>
      {!source.charts.length && (
        <p className="py-5 text-center text-sm text-muted-foreground">
          選擇欄位與計算方式後，按「加入分析報表」。也可讓 AI 建議圖表。
        </p>
      )}
    </div>
  )
}
