import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Hash, Images, MessagesSquare, NotebookText, type LucideIcon } from "lucide-react"
import { Link } from "react-router"

import { listThreads, type Channel } from "@/api/channels"
import { ChannelMembers } from "@/components/channel-members"
import { ChannelRow, channelDetail } from "@/components/channel-row"
import { UnreadDot } from "@/components/channels-link"
import { Notice } from "@/components/notice"
import { railPath, topicsOf } from "@/lib/channel-rail"
import { KIND_LABEL } from "@/lib/channels"
import { cn } from "@/lib/utils"
import type { ChannelLocationState } from "@/pages/channel"

/** 頻道頁的右欄：選中那個頻道的對話、記憶看板、照片與檔案，
 * 加上底下的文字頻道（全國、整區）或有人發過言的客戶討論串（地點）。
 * refreshKey 每次重新載入頻道列表就換一次，客戶討論串跟著重拿 */
export function ChannelPanel({
  channel,
  channels,
  selfId,
  refreshKey,
}: {
  channel: Channel
  channels: Channel[]
  selfId: string
  refreshKey: number
  onChanged: () => void
}) {
  const back = railPath(channel)
  return (
    <section aria-label={channel.name} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-start gap-1 border-b py-2 pr-1 pl-4">
        <div className="min-w-0 flex-1 py-1">
          <h2 className="truncate text-lg font-semibold">{channel.name}</h2>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[channel.kind]}・{channel.audience}
            {channel.online > 0 && `・${channel.online} 人在線`}
          </p>
        </div>
        {!channel.archived && <ChannelMembers channelId={channel.id} selfId={selfId} />}
      </header>
      <div className="flex flex-col gap-5 px-4 pt-4 pb-24">
        {channel.archived && <Notice text="這個頻道已封存，只能看。" />}
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back }} icon={MessagesSquare} label="對話" unread={channel.unread} />
          <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back, tab: "board" }} icon={NotebookText} label="記憶看板" />
          <PanelLink to={`/channels/search?channel=${channel.id}`} state={{ backTo: back }} icon={Images} label="照片與檔案" />
        </div>
        {(channel.kind === "national" || channel.kind === "region") && (
          <TopicSection topics={topicsOf(channels, channel.id)} back={back} />
        )}
        {channel.kind === "place" && <ThreadSection place={channel} back={back} refreshKey={refreshKey} />}
      </div>
    </section>
  )
}

function PanelLink({
  to,
  state,
  icon: Icon,
  label,
  unread = 0,
}: {
  to: string
  state?: ChannelLocationState
  icon: LucideIcon
  label: string
  unread?: number
}) {
  return (
    <Link to={to} state={state} className="flex min-h-12 items-center gap-3 border-t px-4 py-2 first:border-t-0">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className={cn("flex-1 text-sm", unread > 0 && "font-semibold")}>{label}</span>
      {unread > 0 && <UnreadDot count={unread} />}
    </Link>
  )
}

/** 全國、整區底下的文字頻道：沒封存的照開的先後，封存的收在最下面 */
function TopicSection({ topics, back }: { topics: Channel[]; back: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const active = topics.filter((t) => !t.archived)
  const archived = topics.filter((t) => t.archived)
  return (
    <section className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-muted-foreground">文字頻道</h3>
      </div>
      {topics.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed px-4 py-3 text-sm text-muted-foreground">還沒有文字頻道</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          {active.map((topic) => (
            <TopicRow key={topic.id} topic={topic} back={back} />
          ))}
          {archived.length > 0 && (
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-12 w-full items-center gap-2 border-t px-4 text-left text-sm text-muted-foreground first:border-t-0"
            >
              {showArchived ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              已封存（{archived.length}）
            </button>
          )}
          {showArchived && archived.map((topic) => <TopicRow key={topic.id} topic={topic} back={back} />)}
        </div>
      )}
    </section>
  )
}

function TopicRow({ topic, back }: { topic: Channel; back: string }) {
  const detail = channelDetail(topic)
  return (
    <div className="flex min-h-12 items-center border-t first:border-t-0">
      <Link to={`/channels/${topic.id}`} state={{ backTo: back }} className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-4">
        <Hash className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className={cn("flex items-center gap-2 text-sm", topic.unread > 0 && !topic.archived && "font-semibold", topic.archived && "text-muted-foreground")}>
            <span className="truncate">{topic.name}</span>
            {topic.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem]">已封存</span>}
          </p>
          {detail.length > 0 && <p className="text-[0.6875rem] text-muted-foreground">{detail.join(" · ")}</p>}
        </div>
        {topic.unread > 0 && !topic.archived && <UnreadDot count={topic.unread} />}
      </Link>
    </div>
  )
}

type ThreadState = { status: "loading" } | { status: "error" } | { status: "ready"; threads: Channel[] }

/** 地點底下有人發過言的客戶討論串。沒發過言的從客戶檔案的「討論串」按鈕開 */
function ThreadSection({ place, back, refreshKey }: { place: Channel; back: string; refreshKey: number }) {
  const [state, setState] = useState<ThreadState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    listThreads(place.id, controller.signal)
      .then((threads) => setState({ status: "ready", threads }))
      .catch(() => {
        // 已經有清單就留著，重新載入失敗不必把畫面清掉
        if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
      })
    return () => controller.abort()
  }, [place.id, refreshKey])

  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 text-xs font-semibold text-muted-foreground">客戶討論串</h3>
      {state.status === "loading" && <p className="py-4 text-center text-sm text-muted-foreground">載入中…</p>}
      {state.status === "error" && <Notice text="連不上伺服器，討論串沒有載入。" />}
      {state.status === "ready" && state.threads.length === 0 && (
        <Notice text="這裡的客戶還沒有人開討論串。要開一個，從客戶檔案右上角的「討論串」進去。" />
      )}
      {state.status === "ready" && state.threads.length > 0 && (
        <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          {state.threads.map((thread) => (
            <ChannelRow key={thread.id} channel={thread} backTo={back} />
          ))}
        </div>
      )}
    </section>
  )
}
