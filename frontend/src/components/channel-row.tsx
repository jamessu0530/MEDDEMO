import { Link } from "react-router"

import type { Channel } from "@/api/channels"
import { UnreadDot } from "@/components/channels-link"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** 頻道列表、客戶討論串清單的一列：名稱（有未讀就粗體）、最近一則的時間、除了自己幾人在線、未讀數。
 * backTo 是進到頻道後返回鍵要回哪裡，沒給就回頻道列表 */
export function ChannelRow({ channel, indent = false, backTo }: { channel: Channel; indent?: boolean; backTo?: string }) {
  const detail = [
    channel.last_message_at && `最近 ${formatDateTime(channel.last_message_at)}`,
    channel.online > 0 && `${channel.online} 人在線`,
  ].filter(Boolean)
  return (
    <Link
      to={`/channels/${channel.id}`}
      state={backTo ? { backTo } : undefined}
      className={cn("flex min-h-12 items-center gap-3 border-t py-2 pr-4 first:border-t-0", indent ? "pl-10" : "pl-4")}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", channel.unread > 0 && "font-semibold")}>{channel.name}</p>
        {detail.length > 0 && <p className="text-[11px] text-muted-foreground">{detail.join(" · ")}</p>}
      </div>
      {channel.unread > 0 && <UnreadDot count={channel.unread} />}
    </Link>
  )
}
