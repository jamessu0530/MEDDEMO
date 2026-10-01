import { useEffect, useRef, useState } from "react"
import { SendHorizontal, Store } from "lucide-react"
import { Link, useLocation, useParams } from "react-router"

import { ApiError } from "@/api/client"
import {
  deleteMessage,
  getChannel,
  listMessages,
  markRead,
  postMessage,
  type Channel,
  type ChannelMessage,
} from "@/api/channels"
import { AttachmentGallery } from "@/components/attachments/attachment-gallery"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
import { ChannelMembers } from "@/components/channel-members"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { LiveAvatar } from "@/components/user-avatar"
import { addDraftFiles, removeDraftFile, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { channelUnread } from "@/lib/channel-unread"
import { awaitingMascot, MESSAGE_PAGE, mergeMessages, withMascotMention } from "@/lib/channels"
import { formatDateTime } from "@/lib/format"
import { realtime, useRealtimeConnected } from "@/lib/realtime"
import { cn } from "@/lib/utils"

// 新訊息靠 WebSocket 通知（lib/realtime.ts），收到才去拿；連著的時候另外每 30 秒保險問一次，
// 斷線時回到每 3 秒輪詢。畫面在背景就不問
const POLL_MS = 3_000
const POLL_CONNECTED_MS = 30_000
const MAX_LENGTH = 2000
// 一則訊息最多附幾個檔案（跟後端一樣）
const MAX_FILES = 4
// IT 刪掉的訊息換成這一句（跟後端 services/channels.DELETED_BODY 一樣）
const DELETED_BODY = "（這則訊息已被 IT 刪除）"
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
  const selfId = useAuth()?.user.id ?? ""
  const connected = useRealtimeConnected()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [draft, setDraft] = useState("")
  const [files, setFiles] = useState<DraftFile[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // 上傳進度（0–1）；沒有附檔案時是 null，不顯示進度條
  const [progress, setProgress] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ChannelMessage | null>(null)
  const isIt = useAuth()?.user.role === "it"
  const bottom = useRef<HTMLDivElement>(null)
  // 輪詢「這則之後的新訊息」從哪裡接：只跟著拿到的那一頁前進，不跟著自己剛送出的那則。
  // 自己的那則可能比別人同時送出、還沒拿到的那則編號大，跟著它跳就永遠拿不到別人那則
  const cursor = useRef(0)
  const main = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  // 「熊熊滾正在想」要跟著時間消失：每次去拿新訊息時更新現在時間（連著時至少 30 秒一次，斷線時 3 秒）
  const [now, setNow] = useState(() => Date.now())
  // 使用者是不是還停在底部附近：只有這樣，或最新一則是自己剛送出的，拿到新訊息時才把畫面捲到最下面；
  // 不然使用者往上捲看舊訊息時會被強制拉回去
  const nearBottom = useRef(true)
  const seenFirstLoad = useRef(false)
  const lastId = messages.at(-1)?.id
  const lastMine = messages.at(-1)?.mine

  function handleScroll() {
    const el = main.current
    if (!el) return
    const wasNearBottom = nearBottom.current
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    // 從上面捲回底部：把讀歷史訊息時錯過的新訊息補標成已讀，紅點才會跟著消掉
    if (nearBottom.current && !wasNearBottom && lastId !== undefined) {
      markRead(id, lastId)
        .then(() => channelUnread.refresh())
        .catch(() => {
          // 下一次捲回底部再標一次
        })
    }
  }

  // 頻道資訊與最新一頁
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listMessages(id, {}, controller.signal)])
      .then(([channel, page]) => {
        setState({ status: "ready", channel })
        setMessages(page)
        cursor.current = page.at(-1)?.id ?? 0
        setHasOlder(page.length === MESSAGE_PAGE)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [id])

  // 拿新訊息：收到這個頻道的通知、重連或切回前景時補漏掉的，加上輪詢。
  // 一次只問一個；問的時候又來了通知，問完再問一次，不會漏也不會同時打好幾個
  useEffect(() => {
    if (state.status !== "ready") return
    const controller = new AbortController()
    let busy = false
    let again = false
    const fetchNew = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return
      setNow(Date.now())
      if (busy) {
        again = true
        return
      }
      busy = true
      listMessages(id, { after: cursor.current }, controller.signal)
        .then((page) => {
          if (!page.length) return
          cursor.current = Math.max(cursor.current, page.at(-1)!.id)
          setMessages((current) => mergeMessages(current, page))
          // 一次最多一頁，滿了就是還有
          if (page.length === MESSAGE_PAGE) again = true
        })
        .catch(() => {
          // 連不上就等下一輪
        })
        .finally(() => {
          busy = false
          if (again && !controller.signal.aborted) {
            again = false
            fetchNew()
          }
        })
    }
    // 連線狀態一變（剛重連上）這裡會重跑，先補一次：重連當下發的 resync 可能被上一輪的 abort 取消了
    fetchNew()
    const timer = setInterval(fetchNew, connected ? POLL_CONNECTED_MS : POLL_MS)
    const unsubscribe = realtime.subscribe((event) => {
      if (event.type === "resync" || event.channel_id === id) fetchNew()
    })
    // 連著但畫面在背景時收到的通知會被略過，切回前景補一次
    const onVisible = () => document.visibilityState === "visible" && fetchNew()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
      controller.abort()
    }
  }, [id, state.status, connected])

  // 看到最新一則就算讀過，紅點跟著更新。只在還在底部附近、新的這則是自己剛送出的，或第一次載入時才標記，
  // 不然往上捲看歷史訊息時，輪詢進來的新訊息會被誤標成已經讀過（往回捲底部再標，見 handleScroll）。
  // 捲到最下面用同一組條件：第一次載入一定捲；之後只有還在底部附近，或新的這則是自己剛送出的才捲，
  // 免得使用者往上捲看舊訊息時被強制拉回去
  useEffect(() => {
    if (lastId === undefined) return
    const firstLoad = !seenFirstLoad.current
    seenFirstLoad.current = true
    if (firstLoad || nearBottom.current || lastMine) {
      bottom.current?.scrollIntoView({ block: "end" })
      markRead(id, lastId)
        .then(() => channelUnread.refresh())
        .catch(() => {
          // 下一則進來會再記一次
        })
    }
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

  function pick(picked: File[]) {
    const result = addDraftFiles(files, picked, MAX_FILES)
    setFiles(result.files)
    setPickError(result.error)
  }

  function callMascot() {
    setDraft((current) => withMascotMention(current))
    textarea.current?.focus()
  }

  async function send() {
    const body = draft.trim()
    if ((!body && !files.length) || sending) return
    setSending(true)
    setSendError(null)
    setPickError(null)
    setProgress(files.length ? 0 : null)
    try {
      const ready = await Promise.all(files.map((draftFile) => shrinkPhoto(draftFile.file)))
      const message = await postMessage(id, body, ready, setProgress)
      setMessages((current) => mergeMessages(current, [message]))
      setDraft("")
      setFiles([])
    } catch (error) {
      // 文字與檔案都留在輸入框，讓人直接重送
      setSendError(error instanceof ApiError ? error.message : "沒有送出，請再試一次")
    } finally {
      setSending(false)
      setProgress(null)
    }
  }

  async function confirmDelete(message: ChannelMessage) {
    await deleteMessage(message.id)
    setMessages((current) =>
      current.map((m) => (m.id === message.id ? { ...m, body: DELETED_BODY, deleted: true, attachments: [] } : m))
    )
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
  const byId = new Map(messages.map((m) => [m.id, m]))
  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title={channel.name}
        subtitle={KIND_LABEL[channel.kind]}
        backTo={backTo}
        trailing={channel.archived ? undefined : <ChannelMembers channelId={channel.id} selfId={selfId} />}
      />
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
          <MessageBubble
            key={message.id}
            message={message}
            replyTo={byId.get(message.reply_to_id ?? -1)}
            onDelete={isIt && !message.deleted ? setDeleting : undefined}
          />
        ))}
        {awaitingMascot(messages, now) && (
          <div className="flex items-end gap-2" aria-live="polite">
            <Mascot state="think" size={28} bust className="shrink-0 rounded-full bg-accent" />
            <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">熊熊滾正在想…</p>
          </div>
        )}
        <div ref={bottom} />
      </main>
      <footer className="border-t bg-card px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {channel.archived ? (
          <p className="py-2 text-center text-sm text-muted-foreground">這個小組頻道已封存，不能再發言。</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 pb-1">
              <p className="text-[11px] text-muted-foreground">{channel.audience}</p>
              <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs text-primary" onClick={callMascot}>
                {/* Button 會把沒寫 size- 的 svg 縮成 14px，頭像要自己給尺寸 */}
                <Mascot size={18} bust className="size-4.5" />
                @熊熊滾
              </Button>
            </div>
            {(sendError ?? pickError) && <p className="pb-1 text-xs text-destructive">{sendError ?? pickError}</p>}
            <DraftFiles files={files} disabled={sending} onRemove={(key) => setFiles((current) => removeDraftFile(current, key))} />
            {progress !== null && (
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="上傳進度" aria-valuenow={Math.round(progress * 100)}>
                <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            <div className="flex items-end gap-1">
              <AttachButton onPick={pick} disabled={sending || files.length >= MAX_FILES} />
              <Textarea
                ref={textarea}
                value={draft}
                maxLength={MAX_LENGTH}
                rows={1}
                placeholder="回報一件事，或 @熊熊滾 問問題…"
                className="max-h-32 min-h-11 flex-1 resize-none"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                className="size-11 shrink-0"
                aria-label="送出"
                disabled={(!draft.trim() && !files.length) || sending}
                onClick={() => void send()}
              >
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </>
        )}
      </footer>
      {deleting && <DeleteDialog message={deleting} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />}
    </div>
  )
}

/** IT 刪訊息前再確認一次：刪掉就救不回來，附件也一起刪 */
function DeleteDialog({
  message,
  onConfirm,
  onClose,
}: {
  message: ChannelMessage
  onConfirm: (message: ChannelMessage) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(message)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "沒有刪掉，請再試一次")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>刪除這則訊息？</DialogTitle>
          <DialogDescription>
            {message.author_name} · {formatDateTime(message.created_at)}。內容會換成「{DELETED_BODY}」，
            {message.attachments.length ? `附的 ${message.attachments.length} 個檔案也會刪掉，` : ""}刪了就救不回來。
          </DialogDescription>
        </DialogHeader>
        {message.body && <p className="line-clamp-4 rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{message.body}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" className="h-11" disabled={busy} onClick={() => void submit()}>
            {busy ? "刪除中…" : "刪除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MessageBubble({
  message,
  replyTo,
  onDelete,
}: {
  message: ChannelMessage
  replyTo?: ChannelMessage
  onDelete?: (message: ChannelMessage) => void
}) {
  if (message.kind !== "user") {
    // 熊熊滾與風險通報用同一種樣式；熊熊滾的左邊多一個頭像，標出回覆誰（提問那一則在畫面上才標得出來）
    const replied = replyTo && (replyTo.mine ? " · 回覆你" : ` · 回覆 ${replyTo.author_name}`)
    const bubble = (
      <div className="rounded-xl bg-muted px-3 py-2 text-sm">
        <p className="text-[11px] text-muted-foreground">
          {message.kind === "ai" ? "熊熊滾" : "風險通報"}
          {replied} · {formatDateTime(message.created_at)}
        </p>
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
    )
    if (message.kind !== "ai") return bubble
    return (
      <div className="flex items-end gap-2">
        <Mascot size={28} bust className="shrink-0 rounded-full bg-accent" />
        <div className="min-w-0 flex-1">{bubble}</div>
      </div>
    )
  }
  const bubble = (
    <div className={cn("flex min-w-0 flex-col gap-0.5", message.mine && "items-end")}>
      <p className="px-1 text-[11px] text-muted-foreground">
        {message.mine ? "" : `${message.author_name} · `}
        {formatDateTime(message.created_at)}
        {onDelete && (
          <button type="button" className="ml-2 text-destructive underline-offset-2 hover:underline" onClick={() => onDelete(message)}>
            刪除
          </button>
        )}
      </p>
      {message.deleted ? (
        <p className="rounded-2xl border border-dashed px-3 py-2 text-sm text-muted-foreground italic">{message.body}</p>
      ) : (
        message.body && (
          <p
            className={cn(
              "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
              message.mine ? "bg-primary text-primary-foreground" : "border-2 bg-card"
            )}
          >
            {message.body}
          </p>
        )
      )}
      <AttachmentGallery
        attachments={message.attachments}
        className={cn("w-64 max-w-full", message.mine && "items-end")}
      />
    </div>
  )
  if (message.mine) return <div className="max-w-[85%] self-end">{bubble}</div>
  if (!message.author_id) return <div className="max-w-[85%] self-start">{bubble}</div>
  // 別人的訊息左邊放頭像，右下角是他現在的狀態
  return (
    <div className="flex max-w-[85%] items-end gap-2 self-start">
      <LiveAvatar id={message.author_id} name={message.author_name ?? "?"} />
      {bubble}
    </div>
  )
}
