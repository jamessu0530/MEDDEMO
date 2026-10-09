import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { listChannels, type Channel } from "@/api/channels"
import { BottomNav } from "@/components/bottom-nav"
import { ChannelPanel } from "@/components/channel-panel"
import { ChannelRail } from "@/components/channel-rail"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { homePath, useAuth } from "@/lib/auth"
import { rememberChannel, rememberedChannel } from "@/lib/channel-rail"
import { ChannelConversation } from "@/pages/channel"
import { channelPanes } from "@/lib/channel-panes"
import { presence } from "@/lib/presence"
import { realtime } from "@/lib/realtime"
import { useIsDesktop } from "@/lib/use-media-query"

// 有新訊息、有人狀態變了或文字頻道有變動，等這麼久再重新載入一次，一連串的變化併成一次
const RELOAD_DELAY_MS = 3_000

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; channels: Channel[]; loadedAt: number }

/** 頻道頁，跟 Discord 手機版一樣分左右兩欄：左邊是全國、各區、各小組與地點，
 * 右邊是選中那個頻道的對話、記憶看板、照片與檔案，以及底下的文字頻道或客戶討論串。
 * 電腦版（≥1024px）是四欄：頻道列、頻道內容、對話、記憶看板（≥1280px），/channels/:id 也是這一頁（App.tsx 的 ChannelsEntry）。
 * 選中哪個放在網址的 ?c=，也記在這支手機上，下次打開還停在那裡 */
export function ChannelsPage() {
  const user = useAuth()?.user
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  // 電腦版的 /channels/:id：對話欄開哪一個（App.tsx 的 ChannelsEntry 只在電腦版把這個網址交給這一頁）
  const { channelId } = useParams()
  const routeId = channelId === undefined ? null : Number(channelId)
  const badRoute = routeId !== null && !(Number.isInteger(routeId) && routeId > 0)
  // 對話欄載入的那個頻道：客戶討論串不在頻道清單裡，要等它載入才知道頻道列要選哪一個
  const [opened, setOpened] = useState<Channel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      listChannels(controller.signal)
        .then((channels) => setState({ status: "ready", channels, loadedAt: Date.now() }))
        .catch(() => {
          if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
        })
    void load()
    // 從頻道回來、手機切回前景時更新未讀數
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    // 未讀數、「N 人在線」與文字頻道跟著 WebSocket 的通知更新
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        void load()
      }, RELOAD_DELAY_MS)
    }
    // 主管頁的位置、行程通知跟這頁無關，不重新載入
    const offRealtime = realtime.subscribe(
      (event) => (event.type === "message" || event.type === "resync" || event.type === "channels") && soon()
    )
    const offPresence = presence.subscribe(soon)
    return () => {
      controller.abort()
      document.removeEventListener("visibilitychange", onVisible)
      clearTimeout(timer)
      offRealtime()
      offPresence()
    }
  }, [attempt])

  const requested = Number(params.get("c")) || null
  const panes =
    state.status === "ready" && user && !badRoute
      ? channelPanes({ channels: state.channels, routeId, requested, remembered: rememberedChannel(), role: user.role, opened })
      : null
  const selected = state.status === "ready" && panes?.railId != null ? (state.channels.find((c) => c.id === panes.railId) ?? null) : null
  const selectedId = selected?.id ?? null

  useEffect(() => {
    if (selectedId !== null) rememberChannel(selectedId)
  }, [selectedId])

  const sales = user?.role === "sales"
  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title="頻道"
        backTo={sales || !user ? undefined : homePath(user.role)}
        trailing={
          <Link to="/channels/search" aria-label="找照片與檔案" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <Search className="size-5" />
          </Link>
        }
      />
      {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入頻道中…</p>}
      {state.status === "error" && (
        <main className="p-4">
          <Notice text="連不上伺服器，頻道沒有載入。" action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        </main>
      )}
      {state.status === "ready" && user && !desktop && (
        <div className="flex min-h-0 flex-1">
          <ChannelRail
            channels={state.channels}
            selectedId={selectedId}
            onSelect={(channel) => setParams({ c: String(channel.id) }, { replace: true })}
          />
          {selected ? (
            <ChannelPanel
              key={selected.id}
              channel={selected}
              channels={state.channels}
              selfId={user.id}
              refreshKey={state.loadedAt}
              onChanged={() => setAttempt((n) => n + 1)}
            />
          ) : (
            <main className="flex-1 p-4">
              <Notice text="還沒有看得到的頻道。" />
            </main>
          )}
        </div>
      )}
      {state.status === "ready" && user && desktop && (
        <div className="flex min-h-0 flex-1">
          <ChannelRail channels={state.channels} selectedId={selectedId} onSelect={(channel) => navigate(`/channels/${channel.id}`)} />
          <div className="flex w-60 shrink-0 border-r">
            {selected && (
              <ChannelPanel
                key={selected.id}
                channel={selected}
                channels={state.channels}
                selfId={user.id}
                refreshKey={state.loadedAt}
                onChanged={() => setAttempt((n) => n + 1)}
                openId={panes?.openId ?? null}
                compact
              />
            )}
          </div>
          {panes?.openId != null ? (
            <ChannelConversation key={panes.openId} id={panes.openId} layout="pane" onLoaded={setOpened} />
          ) : (
            <main className="flex-1 p-4">
              <Notice text={badRoute ? "找不到這個頻道，或是你看不到它。" : "還沒有看得到的頻道。"} />
            </main>
          )}
        </div>
      )}
      {sales && <BottomNav />}
    </div>
  )
}
