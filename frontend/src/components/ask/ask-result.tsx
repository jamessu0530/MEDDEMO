import { useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { Link } from "react-router"

import { escalateAsk, isFinished, type Ask, type TraceItem } from "@/api/asks"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STEP_LABEL: Record<TraceItem["step"], string> = {
  sql: "查詢",
  search: "檢索",
  rewrite: "改寫問法",
  answer: "整理答案",
  stop: "停止",
}

/** 一個提問的答案：進行中顯示查到第幾輪；查完顯示答案與依據（結果表或出處），查不到可以轉主管 */
export function AskAnswer({ ask, onChange }: { ask: Ask; onChange: (ask: Ask) => void }) {
  if (!isFinished(ask)) {
    const last = ask.trace.at(-1)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {last ? `第 ${last.round} 輪${STEP_LABEL[last.step]}：${last.decision}` : "思考要怎麼查…"}
      </p>
    )
  }
  if (ask.status === "failed") {
    return <p className="text-sm text-destructive">{ask.error_message}</p>
  }
  const sources = ask.evidence?.sources ?? []
  return (
    <div className="flex flex-col gap-3">
      {ask.status === "no_evidence" && <p className="text-sm font-medium">查無依據</p>}
      {ask.status === "not_converged" && <p className="text-sm font-medium">查了三輪還答不完整，以下是已經查到的部分</p>}
      <p className="text-sm leading-relaxed whitespace-pre-line">{ask.answer}</p>
      {ask.evidence?.blocked_reason && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">卡住的原因：{ask.evidence.blocked_reason}</p>
      )}
      {ask.evidence?.columns && ask.evidence.rows && <ResultTable columns={ask.evidence.columns} rows={ask.evidence.rows} />}
      {sources.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">出處</p>
          {sources.map((source) => (
            <details key={source.chunk_id} className="rounded-lg bg-muted px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                {source.doc_title}｜{source.section}
              </summary>
              <p className="mt-1.5 leading-relaxed whitespace-pre-line text-muted-foreground">{source.content}</p>
            </details>
          ))}
        </div>
      )}
      {(ask.status === "no_evidence" || ask.status === "not_converged") && <Escalate ask={ask} onChange={onChange} />}
    </div>
  )
}

/** FR-8.4：查不到就轉給主管，不讓業務卡在這裡 */
function Escalate({ ask, onChange }: { ask: Ask; onChange: (ask: Ask) => void }) {
  const [busy, setBusy] = useState(false)
  if (ask.escalation_id) {
    return (
      <p className="text-xs text-muted-foreground">
        已轉給主管（單號 #{ask.escalation_id}），有回覆會通知你。
        <Link to="/escalations" className="ml-1 font-medium text-primary">
          看主管回覆
        </Link>
      </p>
    )
  }
  return (
    <Button
      variant="outline"
      className="h-11"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          onChange(await escalateAsk(ask.id))
        } finally {
          setBusy(false)
        }
      }}
    >
      轉給主管回答
    </Button>
  )
}

// 結果表在畫面上最多列 8 列，其餘留在查詢過程裡；語音問答交給模型的也是這 8 列
export const TABLE_PREVIEW_ROWS = 8

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const format = (value: unknown) =>
    typeof value === "number" ? value.toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : String(value ?? "")
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, TABLE_PREVIEW_ROWS).map((row, index) => (
            <tr key={index} className="border-t">
              {row.map((value, cell) => (
                <td key={cell} className="px-2 py-1.5 whitespace-nowrap">
                  {format(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** FR-7.3：可以展開看系統中間查了哪些內容 */
export function TracePanel({ trace, live }: { trace: TraceItem[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-1 text-xs text-muted-foreground"
      >
        查詢過程（{trace.length} 步{live ? "，進行中" : ""}）
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="flex flex-col gap-2 pb-1">
          {trace.map((item, index) => (
            <li key={index} className="rounded-lg bg-muted px-3 py-2 text-xs">
              <p className="font-medium">
                第 {item.round} 輪 · {STEP_LABEL[item.step]}
                {item.row_count !== null && `（${item.step === "sql" ? `${item.row_count} 列` : `${item.row_count} 段`}）`}
              </p>
              {item.search_query && <p className="mt-1 text-muted-foreground">檢索字句：{item.search_query}</p>}
              {item.sql && <pre className="mt-1 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{item.sql.trim()}</pre>}
              <p className="mt-1 text-muted-foreground">{item.decision}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
