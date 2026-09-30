import { useEffect, useState } from "react"
import { CheckCircle2, Circle } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import {
  decideOaForm,
  getOaForm,
  type ContractPayload,
  type DiscountPayload,
  type OaFormDetail,
  type OaStatus,
} from "@/api/oa"
import { Notice } from "@/components/notice"
import { OaModelNote } from "@/components/oa-model"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatRate } from "@/lib/approval"
import { canManage, useAuth } from "@/lib/auth"
import { formatDate, formatDateTime, formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

const TABS = ["表單", "附件", "意見", "簽核流程", "活動日誌"] as const
type Tab = (typeof TABS)[number]

const STATUS_LABEL: Record<OaStatus, string> = {
  draft: "草稿",
  pending: "審核中",
  returned: "已退回",
  rejected: "已駁回",
  approved: "已批准",
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; form: OaFormDetail }

/** 一張申請單（出差單、優惠、合約）：表單、附件、意見、簽核流程、活動日誌 */
export function OaFormPage() {
  const { formId } = useParams()
  const id = Number(formId)
  const navigate = useNavigate()
  const user = useAuth()?.user
  const backTo = user && canManage(user.role) ? "/manager?view=oa" : "/oa/forms"
  const [tab, setTab] = useState<Tab>("表單")
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!Number.isInteger(id)) return
    const controller = new AbortController()
    getOaForm(id, controller.signal)
      .then((form) => setState({ status: "ready", form }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [id, attempt])

  const form = state.status === "ready" ? state.form : null
  const canDecide = Boolean(form?.can_decide)

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title={form?.kind_label ?? "申請單"} subtitle={form?.form_no} backTo={backTo} />
      <div className="flex gap-1 overflow-x-auto border-b px-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm",
              tab === item ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && (
          <Notice
            text="找不到這張申請單。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "返回", onClick: () => navigate(backTo) }}
          />
        )}
        {form && tab === "表單" && <FormTab form={form} />}
        {form && tab === "附件" && <EmptyTab empty={form.attachments.length === 0} items={form.attachments} />}
        {form && tab === "意見" && (
          <EmptyTab
            empty={form.comments.length === 0}
            items={form.comments.map((c) => ({
              id: c.id,
              filename: c.body,
              uploaded_by: c.author_name,
              created_at: c.created_at,
            }))}
            emptyText="沒有物品可以顯示…"
          />
        )}
        {form && tab === "簽核流程" && <StepsTab form={form} />}
        {form && tab === "活動日誌" && <ActivityTab form={form} />}
        {form && canDecide && tab === "表單" && (
          <DecideBar
            form={form}
            onDecided={(next) => setState({ status: "ready", form: next })}
          />
        )}
      </main>
    </div>
  )
}

function FormTab({ form }: { form: OaFormDetail }) {
  return (
    <>
      <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
        <p className="font-medium">
          {form.applicant_name}
          <span className="ml-2 text-muted-foreground">{form.applicant_title}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          員工編號 {form.applicant_id} · {form.unit_name}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">申請日期：{formatDate(form.trip_date ?? form.request_date ?? "")}</p>
      <Field label="文號" value={form.form_no} />
      <Field label="申請種類" value={form.kind_label} />
      <Field label="客戶" value={form.customer_name} />
      <Field label="用途說明" value={form.purpose} />
      {form.kind === "discount" && form.payload && <DiscountFields payload={form.payload as DiscountPayload} />}
      {form.kind === "contract" && form.payload && <ContractFields payload={form.payload as ContractPayload} />}
      {form.model && <OaModelNote model={form.model} />}
      <p className="text-xs text-muted-foreground">
        狀態：{STATUS_LABEL[form.status]}
        {form.model?.auto_approved && "（系統核准）"}
      </p>
    </>
  )
}

/** 優惠申請單的內容：哪一張報價、折扣多少、折前折後的金額、理由 */
function DiscountFields({ payload }: { payload: DiscountPayload }) {
  return (
    <>
      {payload.quote_no && <Field label="報價單號" value={payload.quote_no} />}
      <Field label="折扣" value={`${payload.discount_pct}%`} />
      <Field label="報價金額" value={`${formatMoney(payload.amount)}（折扣前 ${formatMoney(payload.list_amount)}）`} />
      <Field label="申請理由" value={payload.reason || "—"} />
    </>
  )
}

/** 合約申請單的內容：續約多久、兩個費率的調整、到期日、理由。新費率只記在申請單上 */
function ContractFields({ payload }: { payload: ContractPayload }) {
  const rate = (value: { from: number; to: number }) =>
    value.from === value.to ? `${formatRate(value.from)}（不變）` : `${formatRate(value.from)} → ${formatRate(value.to)}`
  const day = (iso: string | null) => iso?.replaceAll("-", "/") ?? "—"
  return (
    <>
      <Field label="續約" value={`${payload.term_months} 個月`} />
      <Field label="上架費率" value={rate(payload.listing_fee_rate)} />
      <Field label="通路獎勵比率" value={rate(payload.channel_reward_rate)} />
      <Field label="合約到期日" value={`${day(payload.old_end_date)} → ${day(payload.new_end_date)}`} />
      <Field label="申請理由" value={payload.reason || "—"} />
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="rounded-xl border bg-card px-3 py-2.5 text-sm">{value}</p>
    </div>
  )
}

function EmptyTab({
  empty,
  items,
  emptyText = "沒有附件",
}: {
  empty: boolean
  items: { id: number; filename: string; uploaded_by: string; created_at: string }[]
  emptyText?: string
}) {
  if (empty) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border bg-card px-4 py-3">
          <p className="text-sm">{item.filename}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {item.uploaded_by} · {formatDateTime(item.created_at)}
          </p>
        </li>
      ))}
    </ul>
  )
}

function StepsTab({ form }: { form: OaFormDetail }) {
  return (
    <div className="flex flex-col gap-0">
      {form.steps.map((step, index) => (
        <div key={step.step_no} className="flex gap-3">
          <div className="flex w-6 flex-col items-center">
            {step.status === "done" ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : (
              <Circle className="size-5 text-muted-foreground" />
            )}
            {index < form.steps.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className={cn("mb-3 flex-1 rounded-xl border bg-card px-3 py-3", step.status === "pending" && "border-primary/40")}>
            <p className="text-sm font-medium">{step.role_label}</p>
            <p className="text-sm">
              {step.name}
              <span className="ml-2 text-muted-foreground">{step.title}</span>
            </p>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">簽核流程：{form.flow_name}</p>
    </div>
  )
}

function ActivityTab({ form }: { form: OaFormDetail }) {
  if (form.activity.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">還沒有紀錄。</p>
  return (
    <ul className="flex flex-col gap-3">
      {form.activity.map((item) => (
        <li key={item.id} className="flex gap-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-[11px] text-muted-foreground">{formatDateTime(item.created_at)}</p>
            <p className="text-sm font-medium">{item.detail}</p>
            <p className="text-xs text-muted-foreground">
              {item.actor_name} · {item.actor_unit}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function DecideBar({ form, onDecided }: { form: OaFormDetail; onDecided: (form: OaFormDetail) => void }) {
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState<"approve" | "reject" | "return" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: "approve" | "reject" | "return") {
    setBusy(action)
    setError(null)
    try {
      onDecided(await decideOaForm(form.id, action, comment.trim() || undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : "簽核失敗，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="意見（選填）"
        rows={2}
        maxLength={2000}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act("return")}>
          退回
        </Button>
        <Button variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act("reject")}>
          駁回
        </Button>
        <Button className="h-11" disabled={busy !== null} onClick={() => void act("approve")}>
          核准
        </Button>
      </div>
    </div>
  )
}
