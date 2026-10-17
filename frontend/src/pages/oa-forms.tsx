import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import {
  getOaCatalog,
  listMyForms,
  type OaTemplate,
  type OaFormItem,
  type OaList,
  type OaStatus,
} from "@/api/oa"
import { OaNav } from "@/components/oa-nav"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { OaDemoButton } from "@/components/ui-demo/oa-demo-button"
import { oaDateText } from "@/lib/approval"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAskPageContext } from "@/ask/use-page-context"

const STATUSES: { id: OaStatus; label: string }[] = [
  { id: "draft", label: "草稿" },
  { id: "pending", label: "審核中" },
  { id: "returned", label: "已退回" },
  { id: "rejected", label: "已駁回" },
  { id: "approved", label: "已批准" },
]

const STATUS_LABEL: Record<OaStatus, string> = Object.fromEntries(
  STATUSES.map((s) => [s.id, s.label])
) as Record<OaStatus, string>

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: OaList }

/** 業務看自己開出去的申請單（出差單、優惠、合約），對齊 OA「我的申請單」 */
export function OaFormsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<OaStatus | undefined>()
  const [templates, setTemplates] = useState<OaTemplate[]>([])
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [application, setApplication] = useState(
    params.get("application") ?? ""
  )
  const [company, setCompany] = useState(params.get("company") ?? "")
  const [unit, setUnit] = useState(params.get("unit") ?? "")
  const [submittedDate, setSubmittedDate] = useState(
    params.get("submitted_date") ?? ""
  )
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const queryString = params.toString()

  useEffect(() => {
    window.scrollTo({ top: 0 })
    const controller = new AbortController()
    getOaCatalog(controller.signal)
      .then((data) =>
        setTemplates(data.templates.filter((item) => !item.query_only))
      )
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    listMyForms(
      filter,
      controller.signal,
      Object.fromEntries(new URLSearchParams(queryString))
    )
      .then((data) => setState({ status: "ready", data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [filter, attempt, queryString])

  const counts = state.status === "ready" ? state.data.counts : {}
  useAskPageContext(
    {
      title: "我的 OA 申請單",
      facts: [
        `狀態篩選：${filter ? STATUS_LABEL[filter] : "全部"}`,
        ...[...params].map(
          ([key, value]) =>
            `${({ application: "應用", q: "搜尋", company: "公司", unit: "部門", submitted_date: "提交日期" } as Record<string, string>)[key] ?? key}篩選：${value}`
        ),
        `目前顯示 ${state.status === "ready" ? state.data.items.length : 0} 筆申請，最多顯示最近 50 筆`,
      ],
    },
    state.status === "ready"
  )

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="我的申請單"
        subtitle="OA 表單 · 申請與進度"
        backTo="/"
        trailing={
          <Button asChild size="sm" variant="outline" className="mr-3 min-h-11">
            <Link to="/oa/apps" data-ui-demo="oa-create-application">
              建立申請
            </Link>
          </Button>
        }
      />
      <OaNav />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 pt-5 pb-10 lg:px-8">
        <div className="flex justify-end">
          <OaDemoButton />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            出差、優惠、合約與 OA 申請表單
          </p>
          <button
            type="button"
            className="shrink-0 text-sm text-primary underline"
            onClick={() => {
              setFilter(undefined)
              setState({ status: "loading" })
              setAttempt((n) => n + 1)
            }}
          >
            顯示全部狀態
          </button>
        </div>
        <div data-ui-demo="oa-statuses" className="grid grid-cols-5 gap-1">
          {STATUSES.map((item) => {
            const n = counts[item.id] ?? 0
            const active = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  // 再點一次目前的篩選不必重抓：篩選沒變，抓資料的 effect 不會再跑，畫面會一直停在載入中
                  if (active) return
                  setFilter(item.id)
                  setState({ status: "loading" })
                }}
                className={cn(
                  "flex min-h-16 press flex-col items-center justify-center rounded-xl border-2 px-1 py-2 text-center",
                  active
                    ? "border-primary bg-primary/5 shadow-lip-primary-soft"
                    : "bg-card shadow-lip"
                )}
              >
                <span className="text-sm font-semibold tabular-nums">
                  {n > 99 ? "99+" : n}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 justify-between lg:hidden"
          aria-expanded={filtersOpen}
          aria-controls="oa-search-filters"
          data-ui-demo={filtersOpen ? undefined : "oa-open-filters"}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          搜尋與篩選
          <span className="text-xs text-muted-foreground">
            {params.size
              ? `已套用 ${params.size} 項`
              : filtersOpen
                ? "收起"
                : "展開"}
          </span>
        </Button>
        <form
          data-ui-demo="oa-filters"
          id="oa-search-filters"
          className={cn(
            "grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3",
            !filtersOpen && "hidden lg:grid"
          )}
          onSubmit={(event) => {
            event.preventDefault()
            const next = new URLSearchParams(
              Object.entries({
                q: query.trim(),
                application,
                company: company.trim(),
                unit: unit.trim(),
                submitted_date: submittedDate,
              }).filter(([, value]) => value)
            )
            setParams(next)
            setFiltersOpen(false)
            window.scrollTo({ top: 0 })
            setState({ status: "loading" })
            setAttempt((n) => n + 1)
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            公司
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="全部公司"
              maxLength={100}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            事業單位／部門
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="全部單位"
              maxLength={100}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            應用
            <NativeSelect
              aria-label="應用"
              value={application}
              onChange={(e) => setApplication(e.target.value)}
            >
              <option value="">全部表單</option>
              <option value="trip">出差單</option>
              <option value="discount">優惠申請單</option>
              <option value="contract">合約申請單</option>
              {templates.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.display_code} {item.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            搜尋
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              placeholder="表單名稱、單號、客戶或表單內容"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            提交／建立日期
            <Input
              type="date"
              value={submittedDate}
              onChange={(e) => setSubmittedDate(e.target.value)}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" size="sm">
              搜尋
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("")
                setApplication("")
                setCompany("")
                setUnit("")
                setSubmittedDate("")
                setParams({})
                setAttempt((n) => n + 1)
              }}
            >
              清除篩選
            </Button>
          </div>
        </form>
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入中…
          </p>
        )}
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
            secondary={{ label: "回首頁", onClick: () => navigate("/") }}
          />
        )}
        {state.status === "ready" && state.data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            這個狀態目前沒有申請單。
          </p>
        )}
        {state.status === "ready" &&
          state.data.items.map((item) => (
            <FormCard key={item.id} item={item} />
          ))}
        {state.status === "ready" && (
          <p className="text-xs text-muted-foreground">
            共 {state.data.total ?? state.data.items.length} 筆
            {(state.data.total ?? 0) > state.data.items.length
              ? `，顯示最近 ${state.data.items.length} 筆，請縮小篩選範圍`
              : ""}
          </p>
        )}
      </main>
    </div>
  )
}

function FormCard({ item }: { item: OaFormItem }) {
  return (
    <Link
      to={`/oa/forms/${item.id}`}
      data-ui-demo="oa-form-card"
      className="press rounded-2xl border-2 bg-card p-4 shadow-lip"
    >
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
            "shrink-0 rounded-md px-2 py-0.5 text-xs",
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
      <p className="mt-1 text-xs text-muted-foreground">
        {oaDateText(item)} · {formatDateTime(item.submitted_at)}{" "}
        {item.status === "draft" ? "建立" : "送出"}
        {item.approver_name ? ` · 等${item.approver_name}簽核` : ""}
      </p>
    </Link>
  )
}
