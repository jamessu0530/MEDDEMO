import { useState } from "react"
import { Archive, MapPin } from "lucide-react"

import type { Channel } from "@/api/channels"
import { UnreadDot } from "@/components/channels-link"
import { AVATAR_TONES } from "@/components/user-avatar"
import { railItems, shortName } from "@/lib/channel-rail"
import { cn } from "@/lib/utils"

/** 頻道頁的左欄：全國、各區、各小組，地點與已封存收在資料夾裡，跟 Discord 手機版的伺服器列一樣。
 * 選中的那一塊左邊有一條指示條；沒選中但有未讀的，左邊一個小點、右下角紅色數字 */
export function ChannelRail({
  channels,
  selectedId,
  onSelect,
}: {
  channels: Channel[]
  selectedId: number | null
  onSelect: (channel: Channel) => void
}) {
  // 自己打開的資料夾；裡面有選中的頻道時一律展開
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <nav aria-label="頻道" className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-muted/40 pt-3 pb-24">
      {railItems(channels).map((item) => {
        if (item.type === "divider") return <hr key={item.key} className="w-8 shrink-0 border-t-2" />
        if (item.type === "channel") {
          return (
            <RailButton
              key={item.channel.id}
              channel={item.channel}
              unread={item.unread}
              selected={item.channel.id === selectedId}
              onSelect={onSelect}
            />
          )
        }
        const expanded = open.has(item.key) || item.channels.some((c) => c.id === selectedId)
        const Icon = item.icon === "places" ? MapPin : Archive
        return (
          <div key={item.key} className="flex w-full shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${item.label}（${item.channels.length}）`}
              onClick={() => toggle(item.key)}
              className="relative flex size-12 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 bg-card text-muted-foreground shadow-lip"
            >
              <Icon className="size-4" />
              <span className="text-[0.625rem] leading-none">{item.label}</span>
              {!expanded && item.unread > 0 && <UnreadDot count={item.unread} className="absolute -right-1.5 -bottom-1.5" />}
            </button>
            {expanded && (
              <div className="flex w-14 flex-col items-center gap-2 rounded-2xl bg-muted py-2">
                {item.channels.map((channel) => (
                  <RailButton
                    key={channel.id}
                    channel={channel}
                    unread={channel.unread}
                    selected={channel.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function RailButton({
  channel,
  unread,
  selected,
  onSelect,
}: {
  channel: Channel
  unread: number
  selected: boolean
  onSelect: (channel: Channel) => void
}) {
  return (
    <div className="relative flex w-full shrink-0 justify-center">
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[height]",
          selected ? "h-8" : unread > 0 ? "h-2" : "h-0"
        )}
      />
      <button
        type="button"
        aria-label={unread > 0 ? `${channel.name}，${unread} 則未讀` : channel.name}
        aria-current={selected ? "page" : undefined}
        onClick={() => onSelect(channel)}
        className={cn(
          "relative flex size-12 items-center justify-center rounded-2xl text-sm font-semibold transition-[border-radius]",
          AVATAR_TONES[channel.id % AVATAR_TONES.length],
          selected ? "rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:rounded-xl"
        )}
      >
        {shortName(channel)}
        {unread > 0 && <UnreadDot count={unread} className="absolute -right-1.5 -bottom-1.5" />}
      </button>
    </div>
  )
}
