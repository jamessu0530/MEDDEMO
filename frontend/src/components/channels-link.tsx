import { MessagesSquare } from "lucide-react"
import { Link } from "react-router"

import { useChannelUnread } from "@/lib/channel-unread"
import { cn } from "@/lib/utils"

/** 主管端與組織管理頁沒有底部分頁列，頻道的入口放在標頭，紅點一樣每分鐘更新 */
export function ChannelsLink() {
  const unread = useChannelUnread()
  return (
    <Link
      to="/channels"
      aria-label={unread ? `頻道，${unread} 則未讀` : "頻道"}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
    >
      <MessagesSquare className="size-5" />
      {unread > 0 && <UnreadDot count={unread} className="absolute top-1.5 right-1" />}
    </Link>
  )
}

export function UnreadDot({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
