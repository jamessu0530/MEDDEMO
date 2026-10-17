import { useState, useSyncExternalStore } from "react"
import { useNavigate } from "react-router"
import { ChevronRight, MessageCircle, Search } from "@/components/icons"
import { askSessionFor } from "@/ask/ask-session"
import {
  conversationPath,
  conversationThreads,
} from "@/ask/conversation-threads"
import { useConversation } from "@/ask/use-conversation"
import { AccountMemoryStatus } from "@/components/ask/memory-status"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"

function dateLabel(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "先前的對話"
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function ConversationHistoryPage() {
  const user = useAuth()?.user
  const asking = askSessionFor(user?.id ?? "")
  const entries = useConversation(asking.threads.history)
  const sending = useSyncExternalStore(
    asking.subscribe,
    asking.isBusy,
    asking.isBusy
  )
  const [search, setSearch] = useState("")
  const navigate = useNavigate()
  const threads = conversationThreads(entries)
  const query = search.trim().toLocaleLowerCase()
  const visible = threads.filter(
    (thread) =>
      !query ||
      [
        thread.title,
        thread.page?.title,
        ...thread.entries.map((entry) =>
          entry.kind === "tool"
            ? `${entry.question} ${entry.ask?.answer ?? ""}`
            : entry.text
        ),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
  )
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="對話紀錄"
        backTo={user?.role === "sales" ? "/me" : "/settings"}
      />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
        <p className="text-sm text-muted-foreground">
          回到當時的頁面，接著與熊熊滾聊。
        </p>
        <label className="flex items-center gap-2 rounded-xl border bg-card px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="搜尋對話紀錄"
            placeholder="搜尋對話或頁面…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
        <AccountMemoryStatus memory={asking.memory} />
        {sending && (
          <p role="status" className="text-sm text-muted-foreground">
            熊熊滾正在回答，完成後就能切換對話。
          </p>
        )}
        <div className="flex flex-col gap-3" aria-label="已保存的對話">
          {visible.map((thread) => (
            <button
              key={thread.id}
              type="button"
              disabled={sending}
              onClick={() => {
                if (!asking.threads.resume(thread.id)) return
                navigate(conversationPath(thread.page), {
                  state: { assistantThread: thread.id },
                })
              }}
              className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <MessageCircle
                  className="size-5 text-muted-foreground"
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {thread.title}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {thread.preview}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {dateLabel(thread.updatedAt)}
                  {thread.page ? ` · ${thread.page.title}` : ""}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </button>
          ))}
          {!visible.length && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {query
                ? "找不到符合的對話。"
                : "還沒有對話紀錄，與熊熊滾聊過的內容會出現在這裡。"}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
