import { Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, UserRound } from "@/components/icons"
import { Link, useLocation } from "react-router"

import { CompanyLogo } from "@/components/company-logo"
import { MyStatusButton } from "@/components/my-status"
import { SidebarNav } from "@/components/sidebar-nav"
import { SidebarEdge } from "@/components/sidebar-edge"
import { homePath, type AuthUser } from "@/lib/auth"
import { useChannelUnread } from "@/lib/channel-unread"
import { usePendingOa } from "@/lib/manager-counts"
import { useUnseenReplies } from "@/lib/manager-replies"
import { useUploadQueue } from "@/lib/offline-queue"
import { chooseSkin } from "@/lib/preferences"
import { profilePath, SIDEBAR_ITEM, sidebarItems, type SidebarBadge } from "@/lib/sidebar"
import { useSkin } from "@/lib/skin"
import { cn } from "@/lib/utils"

type Counts = Partial<Record<SidebarBadge, number>>
type SidebarProps = { user: AuthUser; collapsed: boolean; onToggle: () => void }

/**
 * 電腦版左邊的側邊欄（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）：最上面是自己的頭像（點了換狀態）與名字，
 * 中間是這個角色的頁，最下面是深色模式與帳號設定。手機上不畫（lg:flex）。
 * 業務與主管、IT 各自只問自己用得到的數字：業務問主管端的數字會被後端擋
 */
export function AppSidebar(props: SidebarProps) {
  return props.user.role === "sales" ? <SalesSidebar {...props} /> : <ManagerSidebar {...props} />
}

function SalesSidebar(props: SidebarProps) {
  const { items } = useUploadQueue()
  const channels = useChannelUnread()
  const replies = useUnseenReplies()
  // FR-4.3：手機裡還有沒送出的錄音，跟底部分頁列一樣掛在訂單首頁上
  const uploads = items.filter((item) => item.state === "pending").length
  return <Sidebar {...props} counts={{ uploads, channels, replies }} />
}

function ManagerSidebar(props: SidebarProps) {
  const channels = useChannelUnread()
  const oa = usePendingOa()
  return <Sidebar {...props} counts={{ channels, oa }} />
}

function Sidebar({ user, counts, collapsed, onToggle }: SidebarProps & { counts: Counts }) {
  // 外框在 <Routes> 裡面：換頁時墨還沒蓋滿，這裡拿到的還是舊的那一頁，選中的那一列跟著畫面一起換
  const { pathname, search } = useLocation()
  return (
    <>
    <aside
      id="app-sidebar"
      aria-label="側邊欄"
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-[var(--app-sidebar-width)] flex-col gap-1 overflow-x-hidden overflow-y-auto border-r bg-card pt-3 pb-4 lg:flex",
        collapsed ? "px-2" : "px-3"
      )}
    >
      <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "justify-between gap-1")}>
        {!collapsed && (
          <Link to={homePath(user.role)} aria-label="中化裕民業務 AI 助理首頁" className="min-w-0 flex-1 rounded-lg px-2 py-3 hover:bg-muted">
            <CompanyLogo className="w-32" />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "展開側邊欄" : "收合側邊欄"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? "展開側邊欄" : "收合側邊欄"}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        </button>
      </div>
      {!collapsed && <p className="mb-2 px-2 text-xs text-muted-foreground">中化裕民 · 業務 AI 助理</p>}
      <div className={cn("mb-2 flex items-center border-b pb-3", collapsed ? "flex-col gap-1" : "gap-2 px-1")}>
        <MyStatusButton className="size-10" />
        {/* 跟首頁頁首的名字連到同一個地方：業務是個人頁，主管與 IT 是帳號設定 */}
        <Link
          to={profilePath(user.role)}
          aria-label={collapsed ? `${user.name}的${user.role === "sales" ? "個人頁" : "帳號設定"}` : undefined}
          title={collapsed ? `${user.name} · ${user.region}` : undefined}
          className={cn(
            "flex min-h-11 min-w-0 justify-center rounded-lg leading-tight hover:bg-muted",
            collapsed ? "w-full items-center" : "flex-1 flex-col px-1"
          )}
        >
          {collapsed ? <UserRound className="size-5 text-muted-foreground" /> : (
            <>
              <span className="truncate text-sm font-semibold">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user.region}
                {user.acting_as && ` · 共用：${user.acting_as.name}的客戶`}
              </span>
            </>
          )}
        </Link>
      </div>
      <SidebarNav groups={sidebarItems(user.role)} counts={counts} pathname={pathname} search={search} collapsed={collapsed} />
      <div className="flex-1" />
      <SkinRow collapsed={collapsed} />
      <Link
        to="/settings"
        aria-label={collapsed ? "帳號設定" : undefined}
        title={collapsed ? "帳號設定" : undefined}
        className={cn(SIDEBAR_ITEM, "shrink-0 text-muted-foreground hover:bg-muted", collapsed && "justify-center px-0")}
      >
        <Settings className="size-5 shrink-0" />
        <span className={collapsed ? "sr-only" : undefined}>帳號設定</span>
      </Link>
    </aside>
    <SidebarEdge collapsed={collapsed} onToggle={onToggle} />
    </>
  )
}

/** 深色、淺色切換：跟頁首的按鈕一樣，用噴漆從按的位置染過去，也存到帳號上（lib/preferences.ts 的 chooseSkin） */
function SkinRow({ collapsed }: { collapsed: boolean }) {
  const dark = useSkin() === "dark"
  return (
    <button
      type="button"
      onClick={() => chooseSkin(dark ? "light" : "dark")}
      aria-label={collapsed ? (dark ? "換成淺色" : "換成深色") : undefined}
      title={collapsed ? (dark ? "換成淺色" : "換成深色") : undefined}
      className={cn(SIDEBAR_ITEM, "shrink-0 text-muted-foreground hover:bg-muted", collapsed && "justify-center px-0")}
    >
      {dark ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
      <span className={collapsed ? "sr-only" : undefined}>{dark ? "換成淺色" : "換成深色"}</span>
    </button>
  )
}
