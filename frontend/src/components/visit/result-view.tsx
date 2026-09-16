import { useState } from "react"
import { CheckCircle2, CircleAlert, RotateCw, TriangleAlert } from "lucide-react"
import { useNavigate } from "react-router"

import { remainingStops } from "@/api/route"
import { retryWriteback, type RiskNotice, type Visit, type WritebackItem, type WritebackTarget } from "@/api/visits"
import { Button } from "@/components/ui/button"
import { CompetitorNames } from "@/components/visit/competitor-names"
import { readUser } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const TARGETS: { target: WritebackTarget; label: string; content: string }[] = [
  { target: "crm", label: "CRM", content: "拜訪紀錄" },
  { target: "sap", label: "SAP", content: "報價草稿" },
  { target: "oa", label: "OA", content: "出差單" },
]

const STATUS_TEXT: Record<WritebackItem["status"], string> = {
  success: "已寫入",
  skipped: "不需要",
  failed: "未寫入",
  pending: "寫入中",
}

/** 回寫結果（FR-6.2、6.3）：逐項顯示三套系統的結果，失敗的可以單獨重送 */
export function ResultView({ visit, onChange }: { visit: Visit; onChange: (visit: Visit) => void }) {
  const navigate = useNavigate()
  const [retrying, setRetrying] = useState<WritebackTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const results = new Map(visit.writeback.map((item) => [item.target, item]))
  const written = visit.writeback.filter((item) => item.status === "success" || item.status === "skipped").length
  const complete = visit.status === "synced"
  const user = readUser()
  const remaining = user ? remainingStops(user.id, visit.customer_id) : null

  async function retry(target: WritebackTarget) {
    setRetrying(target)
    setError(null)
    try {
      onChange(await retryWriteback(visit.id, target))
    } catch (err) {
      setError(err instanceof Error ? err.message : "重送失敗，請再試一次")
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <div className="flex flex-col items-center gap-1 text-center">
        {complete ? <CheckCircle2 className="size-12 text-success" /> : <CircleAlert className="size-12 text-destructive" />}
        <h2 className="mt-1 text-lg font-semibold">{complete ? "已寫入三套系統" : `三套系統寫入 ${written} 套`}</h2>
        <p className="text-sm text-muted-foreground">{visit.customer_name}</p>
      </div>

      <ul className="flex flex-col gap-2">
        {TARGETS.map(({ target, label, content }) => {
          const item = results.get(target)
          const failed = item?.status === "failed"
          return (
            <li key={target} className={cn("rounded-xl border bg-card px-4 py-3", failed && "border-destructive/40")}>
              <div className="flex items-center gap-3">
                <span className="w-10 font-semibold">{label}</span>
                <span className="flex-1 text-sm text-muted-foreground">{content}</span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    item?.status === "success" && "text-success",
                    failed && "text-destructive"
                  )}
                >
                  {item ? STATUS_TEXT[item.status] : "—"}
                </span>
              </div>
              {item?.error_message && (
                <p className={cn("mt-1 pl-13 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
                  {item.error_message}
                </p>
              )}
              {failed && (
                <Button
                  variant="outline"
                  className="mt-2 h-11 w-full"
                  disabled={retrying !== null}
                  onClick={() => retry(target)}
                >
                  <RotateCw className={cn("size-4", retrying === target && "animate-spin")} />
                  單獨重送 {label}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {!complete && <p className="text-sm text-muted-foreground">其他幾套已經寫進去了，重送只會補上失敗的那一套。</p>}
      {visit.fields.competitor?.length ? (
        <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="w-10 shrink-0 text-muted-foreground">競品</span>
          <span className="min-w-0 flex-1 font-medium">
            <CompetitorNames visit={visit} />
          </span>
        </div>
      ) : null}
      {visit.risk_notice && <RiskNoticeCard notice={visit.risk_notice} />}
      {visit.reminder && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">
          追蹤提醒已建立：{formatDate(visit.reminder.due_date)} {visit.reminder.note}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {/* 回寫完後回今日路線接著跑下一站；還有幾站用手機裡記著的那份路線算，算不出來就只寫「回今日路線」 */}
      <Button className="h-12 text-base" onClick={() => navigate("/")}>
        回今日路線{remaining !== null && remaining > 0 ? ` · 還有 ${remaining} 站` : ""}
      </Button>
      <Button variant="outline" className="h-12 text-base" onClick={() => navigate("/customers")}>
        回客戶清單
      </Button>
    </div>
  )
}

/** 原型「競品御松田已加入風險分，主管同步收到通報」：照後端算的結果寫，不寫死是競品 */
function RiskNoticeCard({ notice }: { notice: RiskNotice }) {
  return (
    <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed">
          {notice.reason}，這家目前 <span className="font-semibold tabular-nums">{notice.score}/{notice.max}</span> 項風險，已通報主管
          {notice.manager_name}
        </p>
        {notice.items.length > 0 && (
          <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed text-foreground/80">
            {notice.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
