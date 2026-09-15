import { useEffect, useState } from "react"
import { useNavigate } from "react-router"

import { listEscalations, markSeen, type Escalation } from "@/api/escalations"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { formatDateTime } from "@/lib/format"
import { managerReplies } from "@/lib/manager-replies"
import { cn } from "@/lib/utils"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; items: Escalation[]; fresh: number[] }

/** 轉給主管的提問（FR-8.4 延伸）：業務看主管的回覆。打開這頁就把新回覆標成看過，首頁的提醒跟著消失 */
export function EscalationsPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listEscalations(undefined, controller.signal)
      .then(async (items) => {
        // 這次才看到的回覆標「新回覆」，同時告訴伺服器看過了
        const fresh = items.filter((item) => item.status === "answered" && !item.seen_at).map((item) => item.id)
        setState({ status: "ready", items, fresh })
        await Promise.all(fresh.map((id) => markSeen(id)))
        void managerReplies.refresh()
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="轉給主管的提問" subtitle="問答查不到時轉出去的問題" backTo="/" />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
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
          <Notice
            text="還沒有轉給主管的提問。問答查不到答案時，可以按「轉給主管回答」。"
            action={{ label: "去問答", onClick: () => navigate("/ask") }}
          />
        )}
        {state.status === "ready" &&
          state.items.map((item) => {
            const fresh = state.fresh.includes(item.id)
            return (
              <article key={item.id} className={cn("rounded-2xl border bg-card p-4", fresh && "border-primary/40")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(item.created_at)} 轉出 · 單號 #{item.id}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-[11px]",
                      item.status === "answered" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {fresh ? "新回覆" : item.status === "answered" ? "主管已回覆" : "等主管回覆"}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{item.question}</p>
                {item.status === "answered" && (
                  <div className="mt-3 rounded-xl bg-primary/10 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-primary">
                      {item.answered_by} 回覆 · {item.answered_at && formatDateTime(item.answered_at)}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                  </div>
                )}
              </article>
            )
          })}
      </main>
    </div>
  )
}
