import { useEffect, useState } from "react"
import { Settings } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { listEscalations, replyEscalation, type Escalation } from "@/api/escalations"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Tab = "open" | "answered"
type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; items: Escalation[] }

/** 主管端（FR-8.4 延伸）：業務查不到答案轉過來的提問，主管在這裡回覆；回覆後業務的首頁會提醒 */
export function ManagerPage() {
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
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="待回覆的提問"
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
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        {/* 回覆的身分就是登入的帳號，業務看到的是這個名字 */}
        {user && <p className="text-xs text-muted-foreground">以 {user.name}（{user.region}主管）的身分回覆</p>}

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
      </main>
    </div>
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
