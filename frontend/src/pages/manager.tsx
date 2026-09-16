import { useEffect, useState } from "react"
import { ChevronRight, Settings, TriangleAlert } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { listEscalations, replyEscalation, type Escalation } from "@/api/escalations"
import { getUnseenNoticeCount, listNotices, markNoticeSeen, type ManagerNotice } from "@/api/notices"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

// 主管端兩個分頁：業務轉來的提問、拜訪提到競品或客訴的風險通報。記在網址上，從客戶檔案回來還停在同一頁
type View = "asks" | "notices"
type Tab = "open" | "answered"
type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; items: Escalation[] }
type NoticeState = { status: "loading" } | { status: "error" } | { status: "ready"; items: ManagerNotice[] }

const NOTICES_PATH = "/manager?view=notices"

/** 主管端（FR-8.4 延伸）：回覆業務轉過來的提問，看自己轄區的風險通報 */
export function ManagerPage() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get("view") === "notices" ? "notices" : "asks"
  const [unseenNotices, setUnseenNotices] = useState(0)

  // 分頁上的未讀數：打開主管端、切換分頁時各問一次；主管在這頁按「知道了」會直接減一，不必重問
  useEffect(() => {
    const controller = new AbortController()
    getUnseenNoticeCount(controller.signal)
      .then(({ count }) => setUnseenNotices(count))
      .catch(() => {
        // 連不上就先不顯示數字，列表那邊會有自己的錯誤訊息
      })
    return () => controller.abort()
  }, [view])

  function switchView(next: View) {
    if (next === view) return
    setParams(next === "notices" ? { view: "notices" } : {}, { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={view === "notices" ? "風險通報" : "待回覆的提問"}
        subtitle="主管端"
        trailing={
          <Link
            to="/settings"
            aria-label="帳號設定"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <Settings className="size-5" />
          </Link>
        }
      />
      <div className="flex border-b bg-background px-4" role="tablist">
        {(["asks", "notices"] as const).map((value) => (
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
            {value === "asks" ? "提問" : "風險通報"}
            {value === "notices" && unseenNotices > 0 && (
              <span
                aria-label={`未讀 ${unseenNotices} 則`}
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
              >
                {unseenNotices}
              </span>
            )}
          </button>
        ))}
      </div>
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        {view === "asks" ? (
          <EscalationsPanel />
        ) : (
          <NoticesPanel onSeen={() => setUnseenNotices((count) => Math.max(0, count - 1))} />
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
      {/* 回覆的身分就是登入的帳號，業務看到的是這個名字；只看得到自己轄區的業務轉來的提問 */}
      {user && <p className="text-xs text-muted-foreground">以 {user.name}（{user.region}主管）的身分回覆{user.region}業務轉來的提問</p>}

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
          <article key={item.id} className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] text-muted-foreground">
              {formatDateTime(item.created_at)} · {item.kind === "data" ? "數字查詢" : "知識查詢"} · 單號 #{item.id}
            </p>
            <p className="mt-1.5 text-sm font-medium">{item.question}</p>
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
      {user && <p className="text-xs text-muted-foreground">{user.region}的業務確認拜訪時提到競品或客訴，會通報到這裡</p>}
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
    <article className={cn("rounded-2xl border bg-card p-4", unseen && "border-destructive/40")}>
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
