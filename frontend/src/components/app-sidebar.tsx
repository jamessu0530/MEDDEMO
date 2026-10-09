import { Moon, Settings, Sun } from "lucide-react"
import { Link, useLocation } from "react-router"

import { MyStatusButton } from "@/components/my-status"
import { SidebarNav } from "@/components/sidebar-nav"
import { changeSkin } from "@/ink/ink"
import type { AuthUser } from "@/lib/auth"
import { useChannelUnread } from "@/lib/channel-unread"
import { usePendingOa, useUnseenNotices } from "@/lib/manager-counts"
import { useUnseenReplies } from "@/lib/manager-replies"
import { useUploadQueue } from "@/lib/offline-queue"
import { SIDEBAR_ITEM, sidebarItems, type SidebarBadge } from "@/lib/sidebar"
import { useSkin } from "@/lib/skin"
import { cn } from "@/lib/utils"

type Counts = Partial<Record<SidebarBadge, number>>

/**
 * 電腦版左邊的側邊欄（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）：最上面是自己的頭像（點了換狀態）與名字，
 * 中間是這個角色的頁，最下面是深色模式與帳號設定。手機上不畫（lg:flex）。
 * 業務與主管、IT 各自只問自己用得到的數字：業務問主管端的數字會被後端擋
 */
export function AppSidebar({ user }: { user: AuthUser }) {
  return user.role === "sales" ? <SalesSidebar user={user} /> : <ManagerSidebar user={user} />
}

function SalesSidebar({ user }: { user: AuthUser }) {
  const { items } = useUploadQueue()
  const channels = useChannelUnread()
  const replies = useUnseenReplies()
  // FR-4.3：手機裡還有沒送出的錄音，跟底部分頁列一樣掛在「客戶」上
  const uploads = items.filter((item) => item.state === "pending").length
  return <Sidebar user={user} counts={{ uploads, channels, replies }} />
}

function ManagerSidebar({ user }: { user: AuthUser }) {
  const channels = useChannelUnread()
  const notices = useUnseenNotices()
  const oa = usePendingOa()
  return <Sidebar user={user} counts={{ channels, notices, oa }} />
}

function Sidebar({ user, counts }: { user: AuthUser; counts: Counts }) {
  // 外框在 <Routes> 裡面：換頁時墨還沒蓋滿，這裡拿到的還是舊的那一頁，選中的那一列跟著畫面一起換
  const { pathname, search } = useLocation()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col gap-1 overflow-y-auto border-r bg-card px-3 pt-3 pb-4 lg:flex">
      <div className="mb-2 flex items-center gap-2 border-b px-1 pb-3">
        <MyStatusButton className="size-10" />
        {/* 跟首頁頁首的名字連到同一個地方 */}
        <Link to="/settings" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-1 leading-tight hover:bg-muted">
          <span className="truncate text-sm font-semibold">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user.region}
            {user.acting_as && ` · 示範：${user.acting_as.name}的客戶`}
          </span>
        </Link>
      </div>
      <SidebarNav groups={sidebarItems(user.role)} counts={counts} pathname={pathname} search={search} />
      <div className="flex-1" />
      <SkinRow />
      <Link to="/settings" className={cn(SIDEBAR_ITEM, "text-muted-foreground hover:bg-muted")}>
        <Settings className="size-5 shrink-0" />
        帳號設定
      </Link>
    </aside>
  )
}

/** 深色、淺色切換：跟頁首的按鈕一樣，用噴漆從按的位置染過去（ink/ink.ts 的 changeSkin） */
function SkinRow() {
  const dark = useSkin() === "dark"
  return (
    <button
      type="button"
      onClick={() => changeSkin(dark ? "light" : "dark")}
      className={cn(SIDEBAR_ITEM, "text-muted-foreground hover:bg-muted")}
    >
      {dark ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
      {dark ? "換成淺色" : "換成深色"}
    </button>
  )
}
