import { useEffect, useRef, useState } from "react"
import { SendHorizontal, Store } from "lucide-react"
import { Link, useLocation, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { getChannel, listMessages, markRead, postMessage, type Channel, type ChannelMessage } from "@/api/channels"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { channelUnread } from "@/lib/channel-unread"
import { MESSAGE_PAGE, mergeMessages } from "@/lib/channels"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// 打開頻道時每 3 秒問一次新訊息；畫面在背景就不問
const POLL_MS = 3_000
const MAX_LENGTH = 2000
// 捲動位置離底部多近算「還在底部」：在這個範圍內，新訊息進來才跟著捲到最下面
const NEAR_BOTTOM_PX = 80
const KIND_LABEL: Record<Channel["kind"], string> = {
  national: "全國頻道",
  region: "整區頻道",
  team: "小組頻道",
  place: "地點頻道",
  customer: "客戶討論串",
}

export type ChannelLocationState = { backTo?: string }
type LoadState = { status: "loading" } | { status: "error"; missing: boolean } | { status: "ready"; channel: Channel }

/** 頻道頁：訊息由舊到新，最新的在最下面；往上捲可以載入更早的。
 * 換頻道（從討論串跳到另一個）時用 key 整個重來，不必在 effect 裡把每個狀態清回初始值 */
export function ChannelPage() {
  const { backTo = "/channels" } = (useLocation().state as ChannelLocationState | null) ?? {}
  const id = Number(useParams().channelId)
  // 網址本身就不是有效的頻道 id（手打的亂數、壞掉的連結）：不必打 API，直接顯示找不到
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="頻道" backTo={backTo} />
        <main className="flex-1 p-4">
          <Notice text="找不到這個頻道，或是你看不到它。" />
        </main>
      </div>
    )
  }
  return <ChannelView key={id} id={id} />
}

function ChannelView({ id }: { id: number }) {
  const { backTo = "/channels" } = (useLocation().state as ChannelLocationState | null) ?? {}
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLElement>(null)
  // 使用者是不是還停在底部附近：只有這樣，或最新一則是自己剛送出的，3 秒一次的輪詢才把畫面捲到最下面；
  // 不然使用者往上捲看舊訊息時會被強制拉回去
  const nearBottom = useRef(true)
  const seenFirstLoad = useRef(false)
  const lastId = messages.at(-1)?.id
  const lastMine = messages.at(-1)?.mine

  function handleScroll() {
    const el = main.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  // 頻道資訊與最新一頁
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listMessages(id, {}, controller.signal)])
      .then(([channel, page]) => {
        setState({ status: "ready", channel })
        setMessages(page)
        setHasOlder(page.length === MESSAGE_PAGE)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [id])

  // 輪詢新訊息
  useEffect(() => {
    if (state.status !== "ready") return
    const controller = new AbortController()
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return
      listMessages(id, { after: lastId ?? 0 }, controller.signal)
        .then((page) => page.length && setMessages((current) => mergeMessages(current, page)))
        .catch(() => {
          // 連不上就等下一輪
        })
    }, POLL_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [id, lastId, state.status])

  // 看到最新一則就算讀過，紅點跟著更新。捲到最下面：第一次載入一定捲；之後只有還在底部附近，
  // 或新的這則是自己剛送出的才捲，免得使用者往上捲看舊訊息時被輪詢進來的訊息拉回去
  useEffect(() => {
    if (lastId === undefined) return
    const firstLoad = !seenFirstLoad.current
    seenFirstLoad.current = true
    if (firstLoad || nearBottom.current || lastMine) {
      bottom.current?.scrollIntoView({ block: "end" })
    }
    markRead(id, lastId)
      .then(() => channelUnread.refresh())
      .catch(() => {
        // 下一則進來會再記一次
      })
  }, [id, lastId, lastMine])

  async function loadOlder() {
    const first = messages[0]?.id
    // 已經在載入中就不要重複打 API（雙擊、手指按到兩次）
    if (first === undefined || loadingOlder) return
    setLoadingOlder(true)
    setOlderError(false)
    try {
      const page = await listMessages(id, { before: first })
      setMessages((current) => mergeMessages(page, current))
      setHasOlder(page.length === MESSAGE_PAGE)
    } catch {
      // 失敗就維持原本的 hasOlder：按鈕留著讓人可以再按一次，不要讓一次連線失敗就永久拿掉「載入更早的訊息」
      setOlderError(true)
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const message = await postMessage(id, body)
      setMessages((current) => mergeMessages(current, [message]))
      setDraft("")
    } catch (error) {
      setSendError(error instanceof ApiError ? error.message : "沒有送出，請再試一次")
    } finally {
      setSending(false)
    }
  }

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="頻道" backTo={backTo} />
        <main className="flex-1 p-4">
          {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
          {state.status === "error" && (
            <Notice text={state.missing ? "找不到這個頻道，或是你看不到它。" : "連不上伺服器，頻道沒有載入。"} />
          )}
        </main>
      </div>
    )
  }

  const { channel } = state
  return (
    <div className="flex h-svh flex-col">
      <PageHeader title={channel.name} subtitle={KIND_LABEL[channel.kind]} backTo={backTo} />
      {channel.kind === "place" && (
        <Link to={`/channels/${channel.id}/threads`} className="flex min-h-11 items-center gap-2 border-b px-4 text-sm text-primary">
          <Store className="size-4" />
          這裡的客戶討論串
        </Link>
      )}
      <main ref={main} onScroll={handleScroll} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {hasOlder && (
          <div className="flex flex-col items-center gap-1">
            <Button variant="ghost" className="self-center text-xs" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "載入中…" : "載入更早的訊息"}
            </Button>
            {olderError && <p className="text-xs text-destructive">更早的訊息沒有載入，請再試一次</p>}
          </div>
        )}
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">還沒有人發言。</p>}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottom} />
      </main>
      <footer className="border-t bg-card px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {channel.archived ? (
          <p className="py-2 text-center text-sm text-muted-foreground">這個小組頻道已封存，不能再發言。</p>
        ) : (
          <>
            <p className="pb-1 text-[11px] text-muted-foreground">{channel.audience}</p>
            {sendError && <p className="pb-1 text-xs text-destructive">{sendError}</p>}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                maxLength={MAX_LENGTH}
                rows={1}
                placeholder="回報一件事…"
                className="max-h-32 min-h-11 flex-1 resize-none"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button className="size-11 shrink-0" aria-label="送出" disabled={!draft.trim() || sending} onClick={() => void send()}>
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </>
        )}
      </footer>
    </div>
  )
}

function MessageBubble({ message }: { message: ChannelMessage }) {
  if (message.kind !== "user") {
    // AI 主理與風險通報（第 3 階段）先用同一種樣式
    return (
      <div className="rounded-xl bg-muted px-3 py-2 text-sm">
        <p className="text-[11px] text-muted-foreground">
          {message.kind === "ai" ? "AI 主理" : "風險通報"} · {formatDateTime(message.created_at)}
        </p>
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
    )
  }
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-0.5", message.mine ? "self-end items-end" : "self-start")}>
      <p className="px-1 text-[11px] text-muted-foreground">
        {message.mine ? "" : `${message.author_name} · `}
        {formatDateTime(message.created_at)}
      </p>
      <p
        className={cn(
          "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
          message.mine ? "bg-primary text-primary-foreground" : "border bg-card"
        )}
      >
        {message.body}
      </p>
    </div>
  )
}
