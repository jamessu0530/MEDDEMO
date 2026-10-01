import { useEffect, useState } from "react"
import { ChevronRight, Network, Settings, TriangleAlert } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { listEscalations, replyEscalation, type Escalation } from "@/api/escalations"
import { customerTypeLabel, listMyMethods, updateMethod, type MethodCard } from "@/api/methods"
import { getUnseenNoticeCount, listNotices, markNoticeSeen, type ManagerNotice } from "@/api/notices"
import { listAutoApproved, listOaInbox, type OaFormItem } from "@/api/oa"
import { AttachmentGallery } from "@/components/attachments/attachment-gallery"
import { ChannelsLink } from "@/components/channels-link"
import { MethodCardForm } from "@/components/method-card-form"
import { Notice } from "@/components/notice"
import { OaModelNote } from "@/components/oa-model"
import { SkinToggle } from "@/components/skin-toggle"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAuth, type AuthUser } from "@/lib/auth"
import { formatProbability, oaDateText } from "@/lib/approval"
import { formatDateTime } from "@/lib/format"
import { tagLabel } from "@/lib/methods"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

// 主管端的分頁：業務轉來的提問、拜訪提到競品或客訴的風險通報、簽核、自己寫的方法卡。
// 記在網址上，從客戶檔案回來還停在同一頁
const VIEWS = ["asks", "notices", "oa", "methods"] as const
type View = (typeof VIEWS)[number]
const VIEW_TITLE: Record<View, string> = { asks: "待回覆的提問", notices: "風險通報", oa: "OA 簽核", methods: "方法卡" }
const VIEW_TAB: Record<View, string> = { asks: "提問", notices: "風險通報", oa: "簽核", methods: "方法卡" }
type Tab = "open" | "answered"
type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; items: Escalation[] }
type NoticeState = { status: "loading" } | { status: "error" } | { status: "ready"; items: ManagerNotice[] }

const NOTICES_PATH = "/manager?view=notices"
const HEADER_BUTTON = "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"

/** 三個分頁看的是誰的事：主管是自己底下的人，IT 是全公司（後端依組織樹過濾，不看轄區） */
function whose(user: AuthUser) {
  return user.role === "it" ? "全公司" : "你團隊"
}

/** 主管端（FR-8.4 延伸）：回覆業務轉過來的提問、看風險通報、簽申請單（出差單、優惠、合約）、寫方法卡。主管看自己底下的人，IT 看全公司 */
export function ManagerPage() {
  const user = useAuth()?.user
  const [params, setParams] = useSearchParams()
  const view: View = VIEWS.find((value) => value === params.get("view")) ?? "asks"
  const [unseenNotices, setUnseenNotices] = useState(0)
  const [pendingOa, setPendingOa] = useState(0)

  // 分頁上的未讀數：打開主管端、切換分頁時各問一次；主管在這頁按「知道了」會直接減一，不必重問
  useEffect(() => {
    const controller = new AbortController()
    getUnseenNoticeCount(controller.signal)
      .then(({ count }) => setUnseenNotices(count))
      .catch(() => {
        // 連不上就先不顯示數字，列表那邊會有自己的錯誤訊息
      })
    listOaInbox(controller.signal)
      .then((data) => setPendingOa(data.counts.pending ?? data.items.length))
      .catch(() => {
        // 連不上就先不顯示數字
      })
    return () => controller.abort()
  }, [view])

  function switchView(next: View) {
    if (next === view) return
    setParams(next === "asks" ? {} : { view: next }, { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={VIEW_TITLE[view]}
        subtitle="主管端"
        trailing={
          <>
            <SkinToggle className="size-11" />
            <ChannelsLink />
            {user?.role === "it" && (
              <Link to="/admin" aria-label="組織管理" className={HEADER_BUTTON}>
                <Network className="size-5" />
              </Link>
            )}
            <Link to="/settings" aria-label="帳號設定" className={HEADER_BUTTON}>
              <Settings className="size-5" />
            </Link>
          </>
        }
      />
      <div className="flex border-b bg-background px-4" role="tablist">
        {VIEWS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => switchView(value)}
            className={cn(
              "-mb-px flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-sm",
              view === value ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {VIEW_TAB[value]}
            {value === "notices" && unseenNotices > 0 && (
              <span
                aria-label={`未讀 ${unseenNotices} 則`}
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
              >
                {unseenNotices}
              </span>
            )}
            {value === "oa" && pendingOa > 0 && (
              <span
                aria-label={`待簽 ${pendingOa} 張`}
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
              >
                {pendingOa}
              </span>
            )}
          </button>
        ))}
      </div>
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        {view === "asks" ? (
          <EscalationsPanel />
        ) : view === "notices" ? (
          <NoticesPanel onSeen={() => setUnseenNotices((count) => Math.max(0, count - 1))} />
        ) : view === "oa" ? (
          <OaInboxPanel />
        ) : (
          <MethodsPanel />
        )}
      </main>
    </div>
  )
}

/** 業務查不到答案轉過來的提問，主管在這裡回覆；回覆後業務的首頁會提醒 */
function EscalationsPanel() {
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [tab, setTab] = useState<Tab>("open")
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listEscalations(tab, controller.signal)
      .then((items) => setState({ status: "ready", items }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [tab, attempt])

  function switchTab(next: Tab) {
    if (next === tab) return
    setState({ status: "loading" })
    setNotice(null)
    setTab(next)
  }

  function replied(item: Escalation) {
    setState((current) =>
      current.status === "ready" ? { status: "ready", items: current.items.filter((i) => i.id !== item.id) } : current
    )
    setNotice(`已回覆「${item.question}」，業務的首頁會提醒他來看。`)
  }

  return (
    <>
      {/* 回覆的身分就是登入的帳號，業務看到的是這個名字 */}
      {user && <p className="text-xs text-muted-foreground">以 {user.name} 的身分回覆{whose(user)}業務轉來的提問</p>}

      <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm" role="tablist">
        {(["open", "answered"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => switchTab(value)}
            className={cn("h-9 rounded-md", tab === value ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
          >
            {value === "open" ? "待回覆" : "已回覆"}
          </button>
        ))}
      </div>

      {notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && (
        <Notice
          text="連不上伺服器，提問沒有載入。"
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
      {state.status === "ready" && state.items.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tab === "open" ? "目前沒有待回覆的提問。" : "還沒有回覆過的提問。"}
        </p>
      )}
      {state.status === "ready" &&
        state.items.map((item) => (
          <article key={item.id} className="rounded-2xl border-2 bg-card p-4 shadow-lip">
            <p className="text-[11px] text-muted-foreground">
              {formatDateTime(item.created_at)} · {item.kind === "data" ? "數字查詢" : "知識查詢"} · 單號 #{item.id}
            </p>
            <p className="mt-1.5 text-sm font-medium">{item.question}</p>
            {item.attachment && <AttachmentGallery attachments={[item.attachment]} className="mt-2 w-56 max-w-full" />}
            {item.system_answer && (
              <p className="mt-2 line-clamp-4 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                系統的回覆：{item.system_answer}
              </p>
            )}
            {item.status === "open" ? (
              <ReplyForm item={item} onReplied={replied} />
            ) : (
              <div className="mt-3 rounded-xl bg-primary/10 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-primary">
                  {item.answered_by} · {item.answered_at && formatDateTime(item.answered_at)}
                </p>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {item.seen_at ? `業務 ${formatDateTime(item.seen_at)} 看過` : "業務還沒看"}
                </p>
              </div>
            )}
          </article>
        ))}
    </>
  )
}

function ReplyForm({ item, onReplied }: { item: Escalation; onReplied: (item: Escalation) => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      onReplied(await replyEscalation(item.id, text.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="回覆業務：可以怎麼做、依據是哪一條規定"
        aria-label={`回覆：${item.question}`}
        maxLength={2000}
        rows={3}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button className="h-11" disabled={busy || !text.trim()} onClick={submit}>
        送出回覆
      </Button>
    </div>
  )
}

/** 風險通報（原型「回寫完成」的「主管同步收到通報」）：業務確認拜訪時提到競品或客訴，這家的風險分通報到這裡 */
function NoticesPanel({ onSeen }: { onSeen: () => void }) {
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [state, setState] = useState<NoticeState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listNotices(controller.signal)
      .then((items) => setState({ status: "ready", items }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  function seen(next: ManagerNotice) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", items: current.items.map((item) => (item.id === next.id ? next : item)) }
        : current
    )
    onSeen()
  }

  return (
    <>
      {user && <p className="text-xs text-muted-foreground">{whose(user)}的業務確認拜訪時提到競品或客訴，會通報到這裡</p>}
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && (
        <Notice
          text="連不上伺服器，風險通報沒有載入。"
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
      {state.status === "ready" && state.items.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有風險通報。</p>
      )}
      {state.status === "ready" && state.items.map((item) => <NoticeCard key={item.id} item={item} onSeen={seen} />)}
    </>
  )
}

function NoticeCard({ item, onSeen }: { item: ManagerNotice; onSeen: (item: ManagerNotice) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unseen = item.seen_at === null

  async function markSeen() {
    setBusy(true)
    setError(null)
    try {
      onSeen(await markNoticeSeen(item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有標成已讀，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={cn("rounded-2xl border-2 bg-card p-4 shadow-lip", unseen && "border-destructive/40")}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] text-muted-foreground">
          {formatDateTime(item.created_at)} · 業務 {item.rep_name}
        </p>
        {unseen && (
          <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">未讀</span>
        )}
      </div>
      {/* 回來時停在風險通報，不是提問 */}
      <Link
        to={`/customers/${item.customer_id}`}
        state={{ backTo: NOTICES_PATH } satisfies CustomerLocationState}
        className="flex min-h-11 items-center gap-1 font-medium"
      >
        <span className="min-w-0 flex-1 leading-snug">{item.customer_name}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      <p className="flex items-start gap-1.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          {item.reason}，這家目前 <span className="font-semibold tabular-nums">{item.score}/{item.max}</span> 項風險
        </span>
      </p>
      {item.items.length > 0 && (
        <ul className="mt-2 flex list-disc flex-col gap-0.5 rounded-lg bg-muted py-2 pr-3 pl-7 text-xs leading-relaxed text-foreground/80">
          {item.items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {unseen ? (
        <Button variant="outline" className="mt-3 h-11 w-full" disabled={busy} onClick={markSeen}>
          知道了
        </Button>
      ) : (
        item.seen_at && <p className="mt-2 text-[11px] text-muted-foreground">{formatDateTime(item.seen_at)} 看過</p>
      )}
    </article>
  )
}

/** 簽核匣：等簽的出差單、優惠與合約申請；下面另外列模型有把握、系統已經核准的單，給主管事後查 */
function OaInboxPanel() {
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; items: OaFormItem[] }>({
    status: "loading",
  })
  const [automatic, setAutomatic] = useState<OaFormItem[]>([])
  const [attempt, setAttempt] = useState(0)

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

  return (
    <>
      {user && (
        <p className="text-xs text-muted-foreground">
          {user.role === "it"
            ? "全公司還沒簽的出差單、優惠與合約申請都在這裡，IT 可以代簽"
            : "你團隊業務的出差單、優惠與合約申請，會送到這裡簽核"}
        </p>
      )}
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
          secondary={{ label: "回提問", onClick: () => navigate("/manager") }}
        />
      )}
      {state.status === "ready" && state.items.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有待簽核的申請單。</p>
      )}
      {state.status === "ready" && state.items.map((item) => <OaInboxCard key={item.id} item={item} />)}
      {automatic.length > 0 && (
        <section className="mt-2 flex flex-col gap-2">
          <p className="text-sm font-semibold">系統已核准</p>
          <p className="text-xs text-muted-foreground">
            規則上區處主管就能簽、模型有把握會過的申請，由系統直接核准，列在這裡給你事後查（最近 {automatic.length} 張）。
          </p>
          {automatic.map((item) => (
            <Link key={item.id} to={`/oa/forms/${item.id}`} className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip press">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm">{item.summary}</p>
                {item.model?.probability != null && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatProbability(item.model.probability)}</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.form_no} · {item.applicant_name} · {item.customer_name} · {oaDateText(item)}
              </p>
            </Link>
          ))}
        </section>
      )}
    </>
  )
}

/** 簽核匣的一張單：種類標籤、一句摘要；優惠與合約多一塊模型的估計與理由 */
function OaInboxCard({ item }: { item: OaFormItem }) {
  return (
    <Link to={`/oa/forms/${item.id}`} className="rounded-2xl border-2 bg-card p-4 shadow-lip press">
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
      <p className="mt-1 text-[11px] text-muted-foreground">{oaDateText(item)}</p>
      {item.model && <OaModelNote model={item.model} className="mt-2" />}
    </Link>
  )
}

type MethodsState = { status: "loading" } | { status: "error" } | { status: "ready"; cards: MethodCard[] }
// 表單開著的時候是在新增，還是在改哪一張
type Editing = { mode: "new" } | { mode: "edit"; card: MethodCard } | null

/** 方法卡：主管把「遇到這種情況怎麼談」寫下來，全公司的業務都看得到。這裡列自己寫的（IT 看全部），可以新增、修改、下架 */
function MethodsPanel() {
  const navigate = useNavigate()
  const user = useAuth()?.user
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
      {user && (
        <p className="text-xs text-muted-foreground">
          {user.role === "it"
            ? "全公司主管寫的方法卡都在這裡，IT 可以修改或下架"
            : `以 ${user.name} 的名字寫給全公司的業務看，不分區`}
        </p>
      )}
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
          secondary={{ label: "回提問", onClick: () => navigate("/manager") }}
        />
      )}
      {state.status === "ready" && state.cards.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          還沒有寫過方法卡。把你平常教業務的做法寫下來，人調走了也還留著。
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
        <summary className="flex min-h-9 cursor-pointer items-center text-xs text-primary">看做法全文</summary>
        <p className="mt-1 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-line">{card.approach}</p>
      </details>
      <p className="mt-2 text-xs">
        採用 <span className="font-semibold tabular-nums">{card.adopted}</span> 次 · 沒幫上{" "}
        <span className="font-semibold tabular-nums">{card.not_helped}</span> 次
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {card.author_name} · {formatDateTime(card.updated_at)} 更新
      </p>
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
