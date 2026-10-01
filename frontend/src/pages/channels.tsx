import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { listChannels, type Channel } from "@/api/channels"
import { BottomNav } from "@/components/bottom-nav"
import { ChannelRow } from "@/components/channel-row"
import { UnreadDot } from "@/components/channels-link"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { homePath, useAuth } from "@/lib/auth"
import { groupChannels } from "@/lib/channels"
import { presence } from "@/lib/presence"
import { realtime } from "@/lib/realtime"

// 有新訊息或有人狀態變了，等這麼久再重新載入一次，一連串的變化併成一次
const RELOAD_DELAY_MS = 3_000

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; channels: Channel[] }

/** 頻道列表：全國、自己的區、自己的小組、區裡的地點。IT 看得到每一區每一組 */
export function ChannelsPage() {
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [openPlaces, setOpenPlaces] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      listChannels(controller.signal)
        .then((channels) => setState({ status: "ready", channels }))
        .catch(() => {
          if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
        })
    void load()
    // 從頻道回來、手機切回前景時更新未讀數
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    // 未讀數與「N 人在線」跟著 WebSocket 的通知更新
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        void load()
      }, RELOAD_DELAY_MS)
    }
    const offRealtime = realtime.subscribe((event) => event.type !== "avatars" && soon())
    const offPresence = presence.subscribe(soon)
    return () => {
      controller.abort()
      document.removeEventListener("visibilitychange", onVisible)
      clearTimeout(timer)
      offRealtime()
      offPresence()
    }
  }, [attempt])

  const sales = user?.role === "sales"
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="頻道" backTo={sales || !user ? undefined : homePath(user.role)} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-24">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入頻道中…</p>}
        {state.status === "error" && (
          <Notice text="連不上伺服器，頻道沒有載入。" action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        )}
        {state.status === "ready" &&
          groupChannels(state.channels).map((section) => {
            const open = openPlaces.has(section.key)
            const placeUnread = section.places.reduce((sum, c) => sum + c.unread, 0)
            return (
              <section key={section.key} className="flex flex-col gap-1">
                <p className="px-1 text-xs font-semibold text-muted-foreground">{section.title}</p>
                <div className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
                  {section.channels.map((channel) => (
                    <ChannelRow key={channel.id} channel={channel} />
                  ))}
                  {section.places.length > 0 && (
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center gap-2 border-t px-4 text-left text-sm"
                      aria-expanded={open}
                      onClick={() =>
                        setOpenPlaces((prev) => {
                          const next = new Set(prev)
                          if (open) next.delete(section.key)
                          else next.add(section.key)
                          return next
                        })
                      }
                    >
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <span className="flex-1">地點（{section.places.length}）</span>
                      {placeUnread > 0 && <UnreadDot count={placeUnread} />}
                    </button>
                  )}
                  {open && section.places.map((channel) => <ChannelRow key={channel.id} channel={channel} indent />)}
                </div>
              </section>
            )
          })}
      </main>
      {sales && <BottomNav />}
    </div>
  )
}
