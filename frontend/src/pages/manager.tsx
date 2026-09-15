import { useEffect, useState } from "react"
import { useNavigate } from "react-router"

import { listEscalations, listManagers, replyEscalation, type Escalation, type Manager } from "@/api/escalations"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Tab = "open" | "answered"
type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; items: Escalation[] }

// 沒有登入（FR-12／13 不在這次範圍）：回覆時選自己是哪一位主管，記在這台裝置上
const MANAGER_KEY = "meddemo:manager-id"

function savedManager() {
  try {
    return localStorage.getItem(MANAGER_KEY) ?? ""
  } catch {
    return ""
  }
}

function saveManager(id: string) {
  try {
    localStorage.setItem(MANAGER_KEY, id)
  } catch {
    // 存不進去就每次重選
  }
}

/** 主管端（FR-8.4 延伸）：業務查不到答案轉過來的提問，主管在這裡回覆；回覆後業務的首頁會提醒 */
export function ManagerPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>("open")
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [managers, setManagers] = useState<Manager[]>([])
  const [managerId, setManagerId] = useState(savedManager)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listManagers(controller.signal)
      .then(setManagers)
      .catch(() => {
        // 主管名單載不到，送出回覆時後端會擋，畫面上的錯誤訊息會說明
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    listEscalations(tab, controller.signal)
      .then((items) => setState({ status: "ready", items }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [tab, attempt])

  const chosen = managers.some((m) => m.id === managerId) ? managerId : (managers[0]?.id ?? "")

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
      <PageHeader title="待回覆的提問" subtitle="主管端" backTo="/" />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-10">
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">回覆身分</span>
          <select
            value={chosen}
            onChange={(event) => {
              setManagerId(event.target.value)
              saveManager(event.target.value)
            }}
            className="h-11 flex-1 rounded-lg border bg-card px-3 text-sm"
          >
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.region}主管）
              </option>
            ))}
          </select>
        </label>

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
                <ReplyForm item={item} managerId={chosen} onReplied={replied} />
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

function ReplyForm({
  item,
  managerId,
  onReplied,
}: {
  item: Escalation
  managerId: string
  onReplied: (item: Escalation) => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      onReplied(await replyEscalation(item.id, managerId, text.trim()))
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
      <Button className="h-11" disabled={busy || !text.trim() || !managerId} onClick={submit}>
        送出回覆
      </Button>
    </div>
  )
}
