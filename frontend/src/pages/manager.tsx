import { useAskPageContext } from "@/ask/use-page-context"
import { useEffect, useState, type ReactNode } from "react"
import { ChartNoAxesCombined, ChevronRight, Clock, Network, Settings } from "@/components/icons"
import { Link, useNavigate, useSearchParams } from "react-router"

import { customerTypeLabel, listMyMethods, updateMethod, type MethodCard } from "@/api/methods"
import { listAutoApproved, listOaInbox, type OaFormDetail, type OaFormItem } from "@/api/oa"
import { ChannelsLink } from "@/components/channels-link"
import { ListRow, MasterDetail } from "@/components/manager/master-detail"
import { CustomerInquiriesPanel } from "@/components/manager/customer-inquiries-panel"
import { CustomerPriorityPanel } from "@/components/manager/customer-priority-panel"
import { FeaturedProductsPanel } from "@/components/manager/featured-products-panel"
import { MethodCardForm } from "@/components/method-card-form"
import { MethodSourceDisplay } from "@/components/method-source-display"
import { Notice } from "@/components/notice"
import { OaFormView } from "@/components/oa-form-view"
import { OaModelNote } from "@/components/oa-model"
import { MyStatusButton } from "@/components/my-status"
import { SkinToggle } from "@/components/skin-toggle"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { OA_STATUS_LABEL, formatProbability, oaDateText } from "@/lib/approval"
import { formatDateTime } from "@/lib/format"
import { itemParam, nextAfter, pickItem } from "@/lib/master-detail"
import { pendingOa, usePendingOa } from "@/lib/manager-counts"
import { tagLabel } from "@/lib/methods"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

// 主管端的分頁：客戶提問（預設）、客戶策略、主推品項、簽核、方法卡。
// 記在網址上，從客戶檔案回來還停在同一頁
const VIEWS = ["inquiries", "priority", "featured", "oa", "methods"] as const
type View = (typeof VIEWS)[number]
const VIEW_TITLE: Record<View, string> = {
  inquiries: "客戶提問",
  priority: "客戶策略",
  featured: "主推品項",
  oa: "OA 簽核",
  methods: "方法卡",
}
const VIEW_TAB: Record<View, string> = { inquiries: "客戶提問", priority: "客戶策略", featured: "主推品項", oa: "簽核", methods: "方法卡" }
// 標頭的圖示按鈕用固定的 44px，不跟著放大字體變大，標題才不會被擠掉（components/channels-link.tsx 同）
const HEADER_BUTTON = "flex size-[44px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"

/** 電腦版右邊打開的是哪一張，記在網址的 ?item=：從客戶檔案、申請單回來還停在同一張。換分頁時 switchView 會清掉 */
function useItemParam(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams()
  const select = (id: number | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id === null) next.delete("item")
        else next.set("item", String(id))
        return next
      },
      { replace: true }
    )
  return [itemParam(params.get("item")), select]
}

/** 主管端：了解團隊的客戶提問、簽申請單、寫方法卡。主管看自己底下的人，IT 看全公司 */
export function ManagerPage() {
  const user = useAuth()?.user
  const [params, setParams] = useSearchParams()
  const view: View = VIEWS.find((value) => value === params.get("view")) ?? "inquiries"
  useAskPageContext({ facts: [
    ...(params.get("rep") ? [`選取的業務編號：${params.get("rep")}`] : []),
    ...(params.get("item") ? [`選取項目編號：${params.get("item")}`] : []),
  ] })
  // 分頁上的數字（lib/manager-counts.ts）：每分鐘問一次，切換分頁時馬上再問一次
  const oaCount = usePendingOa()
  useEffect(() => {
    void pendingOa.refresh()
  }, [view])

  function switchView(next: View) {
    setParams(next === "inquiries" ? {} : { view: next }, { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={VIEW_TITLE[view]}
        subtitle="主管端"
        trailing={
          // 電腦版這些都在側邊欄
          <div className="flex gap-1 lg:hidden">
            <MyStatusButton className="size-[44px]" />
            <SkinToggle className="size-[44px]" />
            <ChannelsLink />
            {user?.role === "it" && (
              <Link to="/admin" aria-label="組織管理" className={HEADER_BUTTON}>
                <Network className="size-5" />
              </Link>
            )}
            <Link to="/me" aria-label="個人主頁" className={HEADER_BUTTON}>
              <Clock className="size-5" />
            </Link>
            <Link to="/settings" aria-label="帳號設定" className={HEADER_BUTTON}>
              <Settings className="size-5" />
            </Link>
          </div>
        }
      />
      <div className="flex overflow-x-auto border-b bg-background px-2 lg:hidden" role="tablist">
        {VIEWS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => switchView(value)}
            className={cn(
              "-mb-px flex h-11 min-w-16 flex-1 shrink-0 items-center justify-center gap-1 border-b-2 px-1 text-[0.8125rem] whitespace-nowrap",
              view === value ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {VIEW_TAB[value]}
            {value === "oa" && oaCount > 0 && (
              <span
                aria-label={`待簽 ${oaCount} 張`}
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
              >
                {oaCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <main
        className={cn(
          "flex flex-1 flex-col gap-3 px-4 pt-3 pb-10 lg:px-6",
          // 方法卡沒有另外排，電腦版放在中間一欄
          view === "methods" && "lg:mx-auto lg:w-full lg:max-w-2xl"
        )}
      >
        <Link to="/reports" className="flex min-h-14 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip lg:hidden">
          <ChartNoAxesCombined className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-sm font-semibold">我的報表<span className="ml-2 text-xs font-normal text-muted-foreground">團隊數字 · AI 調整</span></span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        {view === "inquiries" ? (
          <CustomerInquiriesPanel />
        ) : view === "priority" ? (
          <CustomerPriorityPanel />
        ) : view === "featured" ? (
          <FeaturedProductsPanel />
        ) : view === "oa" ? (
          <OaInboxPanel />
        ) : (
          <MethodsPanel />
        )}
      </main>
    </div>
  )
}

/** 簽核匣：等簽的出差單、優惠與合約申請；下面另外列模型有把握、系統已經核准的單，給主管事後查 */
function OaInboxPanel() {
  const navigate = useNavigate()
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; items: OaFormItem[] }>({
    status: "loading",
  })
  const [automatic, setAutomatic] = useState<OaFormItem[]>([])
  const [attempt, setAttempt] = useState(0)
  const desktop = useIsDesktop()
  const [requested, select] = useItemParam()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listOaInbox(controller.signal)
      .then((data) => setState({ status: "ready", items: data.items }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    listAutoApproved(controller.signal)
      .then((data) => setAutomatic(data.items))
      .catch(() => {
        // 這一區是事後查的，連不上就先不顯示；上面的簽核匣有自己的錯誤訊息
      })
    return () => controller.abort()
  }, [attempt])

  // 電腦版在右邊簽完：重拿清單，接著打開下一張（簽完的那張通常就不在等簽的清單裡了）。側邊欄的數字由申請單內容自己更新
  function decided(form: OaFormDetail) {
    if (state.status === "ready") select(nextAfter([...state.items, ...automatic], form.id))
    setNotice(`${form.form_no} ${OA_STATUS_LABEL[form.status]}`)
    setAttempt((n) => n + 1)
  }

  return (
    <>
      <Link to="/oa/apps" className="self-start text-sm text-primary underline">前往 OA 表單中心</Link>
      {notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && (
        <Notice
          text="連不上伺服器，簽核匣沒有載入。"
          action={{
            label: "重新載入",
            onClick: () => {
              setState({ status: "loading" })
              setAttempt((n) => n + 1)
            },
          }}
          secondary={{ label: "回客戶提問", onClick: () => navigate("/manager") }}
        />
      )}
      {state.status === "ready" && state.items.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有待簽核的申請單。</p>
      )}
      {desktop ? (
        state.status === "ready" &&
        state.items.length + automatic.length > 0 && (
          <OaSplit items={state.items} automatic={automatic} requested={requested} onSelect={select} onDecided={decided} />
        )
      ) : (
        <>
          {state.status === "ready" && state.items.map((item) => <OaInboxCard key={item.id} item={item} />)}
          {automatic.length > 0 && (
            <section className="mt-2 flex flex-col gap-2">
              <p className="text-sm font-semibold">系統已核准</p>
              {automatic.map((item) => (
                <Link key={item.id} to={`/oa/forms/${item.id}`} className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip press">
                  <AutoApprovedSummary item={item} />
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}

function OaInboxCard({ item }: { item: OaFormItem }) {
  return (
    <Link to={`/oa/forms/${item.id}`} className="rounded-2xl border-2 bg-card p-4 shadow-lip press">
      <OaInboxSummary item={item} />
    </Link>
  )
}

/** 簽核匣的一張單：種類標籤、一句摘要；優惠與合約多一塊模型的估計與理由 */
function OaInboxSummary({ item }: { item: OaFormItem }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <Badge variant={item.kind === "trip" ? "secondary" : "default"} className="mt-0.5">
          {item.kind_label}
        </Badge>
        <p className="min-w-0 flex-1 text-sm font-medium">{item.summary}</p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {item.form_no} · {item.applicant_name}
        {item.kind !== "trip" && ` · ${item.customer_name}`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{oaDateText(item)}</p>
      {item.model && <OaModelNote model={item.model} className="mt-2" />}
    </>
  )
}

/** 系統已核准那一區的一列：一句摘要、模型的把握、文號與日期 */
function AutoApprovedSummary({ item }: { item: OaFormItem }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">{item.summary}</p>
        {item.model?.probability != null && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatProbability(item.model.probability)}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.form_no} · {item.applicant_name} · {item.customer_name} · {oaDateText(item)}
      </p>
    </>
  )
}

/** 電腦版：左邊是等簽的單，下面接系統已核准的單；右邊打開選中的那張，在這裡直接簽 */
function OaSplit({
  items,
  automatic,
  requested,
  onSelect,
  onDecided,
}: {
  items: OaFormItem[]
  automatic: OaFormItem[]
  requested: number | null
  onSelect: (id: number) => void
  onDecided: (form: OaFormDetail) => void
}) {
  const selected = pickItem([...items, ...automatic], requested)
  const row = (item: OaFormItem, summary: ReactNode) => (
    <ListRow key={item.id} selected={item.id === selected?.id} onSelect={() => onSelect(item.id)}>
      {summary}
    </ListRow>
  )
  return (
    <MasterDetail
      list={
        <>
          {items.map((item) => row(item, <OaInboxSummary item={item} />))}
          {automatic.length > 0 && <p className="mt-3 text-sm font-semibold">系統已核准</p>}
          {automatic.map((item) => row(item, <AutoApprovedSummary item={item} />))}
        </>
      }
      detail={
        selected && (
          <div className="flex shrink-0 flex-col rounded-2xl border-2 bg-background shadow-lip">
            <OaFormView
              key={selected.id}
              id={selected.id}
              backTo="/manager?view=oa"
              header={(form) => (
                <div className="border-b px-4 py-3">
                  <p className="text-xs text-muted-foreground">{form?.form_no ?? selected.form_no}</p>
                  <h2 className="text-base font-semibold">{form?.kind_label ?? selected.kind_label}</h2>
                </div>
              )}
              onDecided={onDecided}
            />
          </div>
        )
      }
    />
  )
}

type MethodsState = { status: "loading" } | { status: "error" } | { status: "ready"; cards: MethodCard[] }
// 表單開著的時候是在新增，還是在改哪一張
type Editing = { mode: "new" } | { mode: "edit"; card: MethodCard } | null

/** 方法卡：主管把「遇到這種情況怎麼談」寫下來，全公司的業務都看得到。這裡列自己寫的（IT 看全部），可以新增、修改、下架 */
function MethodsPanel() {
  const navigate = useNavigate()
  const [state, setState] = useState<MethodsState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<Editing>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listMyMethods(controller.signal)
      .then((cards) => setState({ status: "ready", cards }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  // 新增的放最前面（後端也是最近改過的在前）；修改、下架只換掉那一張，位置不動
  function saved(next: MethodCard, message: string) {
    setState((current) => {
      if (current.status !== "ready") return current
      const known = current.cards.some((card) => card.id === next.id)
      return {
        status: "ready",
        cards: known ? current.cards.map((card) => (card.id === next.id ? next : card)) : [next, ...current.cards],
      }
    })
    setNotice(message)
    setEditing(null)
  }

  return (
    <>
      <Button className="h-11" disabled={state.status !== "ready"} onClick={() => setEditing({ mode: "new" })}>
        新增方法卡
      </Button>
      {notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && (
        <Notice
          text="連不上伺服器，方法卡沒有載入。"
          action={{
            label: "重新載入",
            onClick: () => {
              setState({ status: "loading" })
              setAttempt((n) => n + 1)
            },
          }}
          secondary={{ label: "回客戶提問", onClick: () => navigate("/manager") }}
        />
      )}
      {state.status === "ready" && state.cards.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
            目前沒有方法卡。
        </p>
      )}
      {state.status === "ready" &&
        state.cards.map((card) => (
          <MyMethodCard
            key={card.id}
            card={card}
            onEdit={() => setEditing({ mode: "edit", card })}
            onChanged={(next) =>
              saved(next, next.status === "retired" ? `「${next.title}」已下架，業務看不到了。` : `「${next.title}」重新上架了。`)
            }
          />
        ))}
      {editing && (
        <MethodCardForm
          card={editing.mode === "edit" ? editing.card : undefined}
          onClose={() => setEditing(null)}
          onSaved={(next) =>
            saved(next, editing.mode === "edit" ? `「${next.title}」改好了。` : `「${next.title}」已上架，全公司的業務都看得到。`)
          }
        />
      )}
    </>
  )
}

/** 主管端的一張方法卡：看得到沒幫上的次數（業務那邊只顯示採用次數），並可以修改、下架、重新上架 */
function MyMethodCard({
  card,
  onEdit,
  onChanged,
}: {
  card: MethodCard
  onEdit: () => void
  onChanged: (card: MethodCard) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retired = card.status === "retired"

  async function setStatus(status: MethodCard["status"]) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await updateMethod(card.id, { status }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有改成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={cn("rounded-2xl border-2 bg-card p-4 shadow-lip", retired && "bg-muted/50")}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("leading-snug font-medium", retired && "text-muted-foreground")}>{card.title}</p>
        {retired && <Badge variant="outline">已下架</Badge>}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{card.situation}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{customerTypeLabel(card.customer_type)}</Badge>
        {card.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tagLabel(tag)}
          </Badge>
        ))}
      </div>
      <details className="mt-2">
        <summary data-ui-demo-open="disclosure" className="flex min-h-9 cursor-pointer items-center text-xs text-primary">看做法全文</summary>
        <p className="mt-1 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-line">{card.approach}</p>
      </details>
      <p className="mt-2 text-xs">
        採用 <span className="font-semibold tabular-nums">{card.adopted}</span> 次 · 沒幫上{" "}
        <span className="font-semibold tabular-nums">{card.not_helped}</span> 次
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {card.source ? `整理上架：${card.author_name}` : card.author_name} · {formatDateTime(card.updated_at)} 更新
      </p>
      <MethodSourceDisplay source={card.source} className="mt-3" />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={onEdit}>
          修改
        </Button>
        <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setStatus(retired ? "published" : "retired")}>
          {retired ? "重新上架" : "下架"}
        </Button>
      </div>
    </article>
  )
}
