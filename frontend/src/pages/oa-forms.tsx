import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"

import { listMyForms, type OaFormItem, type OaList, type OaStatus } from "@/api/oa"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { oaDateText } from "@/lib/approval"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const STATUSES: { id: OaStatus; label: string }[] = [
  { id: "draft", label: "草稿" },
  { id: "pending", label: "審核中" },
  { id: "returned", label: "已退回" },
  { id: "rejected", label: "已駁回" },
  { id: "approved", label: "已批准" },
]

const STATUS_LABEL: Record<OaStatus, string> = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<OaStatus, string>

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: OaList }

/** 業務看自己開出去的申請單（出差單、優惠、合約），對齊 OA「我的申請單」 */
export function OaFormsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<OaStatus>("approved")
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listMyForms(filter, controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [filter, attempt])

  const counts = state.status === "ready" ? state.data.counts : {}

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="我的申請單" subtitle="出差單、優惠與合約申請" backTo="/" />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        <div className="grid grid-cols-5 gap-1">
          {STATUSES.map((item) => {
            const n = counts[item.id] ?? 0
            const active = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFilter(item.id)
                  setState({ status: "loading" })
                }}
                className={cn(
                  "flex flex-col items-center rounded-xl border px-1 py-2 text-center",
                  active ? "border-primary bg-primary/5" : "bg-card"
                )}
              >
                <span className="text-sm font-semibold tabular-nums">{n > 99 ? "99+" : n}</span>
                <span className="text-[10px] text-muted-foreground">{item.label}</span>
              </button>
            )
          })}
        </div>
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，申請單沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "回今日路線", onClick: () => navigate("/") }}
          />
        )}
        {state.status === "ready" && state.data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">這個狀態目前沒有申請單。</p>
        )}
        {state.status === "ready" && state.data.items.map((item) => <FormCard key={item.id} item={item} />)}
      </main>
    </div>
  )
}

function FormCard({ item }: { item: OaFormItem }) {
  return (
    <Link to={`/oa/forms/${item.id}`} className="rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {item.kind_label}
          {/* 沒有人簽、模型有把握直接核准的單 */}
          {item.model?.auto_approved && (
            <Badge variant="outline" className="ml-2 align-middle">
              系統核准
            </Badge>
          )}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-[11px]",
            item.status === "approved" && "bg-primary/10 text-primary",
            item.status === "pending" && "bg-muted text-muted-foreground",
            item.status === "rejected" && "bg-destructive/10 text-destructive",
            item.status === "returned" && "bg-destructive/10 text-destructive"
          )}
        >
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      {/* 出差單的摘要就是客戶與拜訪日，下面兩行已經有了；優惠與合約寫出申請的內容 */}
      {item.kind !== "trip" && <p className="mt-1 text-sm">{item.summary}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {item.form_no} · {item.customer_name}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {oaDateText(item)} · {formatDateTime(item.submitted_at)} 送出
        {item.approver_name ? ` · 等${item.approver_name}簽核` : ""}
      </p>
    </Link>
  )
}
