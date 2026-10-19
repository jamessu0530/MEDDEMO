import { useEffect, useMemo, useState } from "react"
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Home,
  Menu,
  MessageCircle,
  Search,
  Settings,
  X,
} from "lucide-react"
import { Link } from "react-router"

import { openAssistant } from "@/ask/assistant-window"
import { CompanyLogo } from "@/components/company-logo"
import { DemoRoleSwitcher } from "@/components/demo-role-switcher"
import { UserAvatar } from "@/components/user-avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AuthUser } from "@/lib/auth"
import { isActiveItem, sidebarItems, type SidebarBadge } from "@/lib/sidebar"
import { cn } from "@/lib/utils"
import "./workday-home.css"

export function WorkdayHeader({
  user,
  collapsed,
  onToggle,
}: {
  user: AuthUser
  collapsed: boolean
  onToggle: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [query, setQuery] = useState("")
  const items = useMemo(() => {
    const groups = sidebarItems(user.role)
    return [
      { to: "/me", label: "個人主頁 · 公司打卡與目標", icon: Home },
      { to: "/settings", label: "帳號設定 · 個人資料", icon: Settings },
      { to: "/calendar", label: "日曆與提醒", icon: CalendarDays },
      ...groups.main,
      ...groups.more,
    ].filter((item, index, all) => all.findIndex((other) => other.to === item.to) === index)
  }, [user.role])
  const results = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase())
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <header className="wd-global-header">
        <div className="wd-header-start">
          <button
            type="button"
            className="wd-menu-toggle wd-desktop-menu"
            onClick={onToggle}
            aria-label={collapsed ? "展開選單" : "收合選單"}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
          >
            <Menu aria-hidden />
            <span>選單</span>
          </button>
          <button
            type="button"
            className="wd-menu-toggle wd-mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="開啟選單"
          >
            <Menu aria-hidden />
          </button>
          <Link to="/me" className="wd-brand" aria-label="中化裕民個人主頁">
            <CompanyLogo />
          </Link>
        </div>
        <button
          type="button"
          className="wd-global-search"
          onClick={() => setSearchOpen(true)}
          aria-label="搜尋工作與應用程式"
        >
          <Search aria-hidden />
          <span>搜尋工作與應用程式</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="wd-header-actions" aria-label="個人工作工具">
          <button
            type="button"
            className="wd-header-icon wd-header-help"
            onClick={() => {
              setSearchOpen(true)
              setQuery("")
            }}
            aria-label="尋找功能與說明"
          >
            <CircleHelp aria-hidden />
          </button>
          <Link to="/calendar" className="wd-header-icon" aria-label="日曆與提醒">
            <Bell aria-hidden />
          </Link>
          <button
            type="button"
            className="wd-header-icon"
            onClick={openAssistant}
            aria-label="開啟工作助理"
          >
            <MessageCircle aria-hidden />
          </button>
          <button
            type="button"
            className="wd-profile-toggle"
            onClick={() => setProfileOpen(true)}
            aria-label="開啟個人帳號選單"
          >
            <UserAvatar id={user.id} name={user.name} className="size-9" />
          </button>
        </nav>
      </header>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="workday-dialog wd-search-dialog">
          <DialogHeader>
            <DialogTitle>搜尋工作與應用程式</DialogTitle>
            <DialogDescription>尋找目前帳號可使用的功能。</DialogDescription>
          </DialogHeader>
          <label className="wd-search-entry">
            <Search aria-hidden />
            <input
              autoFocus
              aria-label="搜尋功能"
              placeholder="例如：打卡、目標、報表、日曆"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="wd-search-results" aria-label="搜尋結果">
            {results.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setSearchOpen(false)}>
                <Icon aria-hidden />
                <span>{label}</span>
                <ChevronRight aria-hidden />
              </Link>
            ))}
          </nav>
          {!results.length && <p className="wd-empty-line">沒有符合的功能，請換個關鍵字。</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="workday-dialog wd-mobile-nav-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>選單</DialogTitle>
            <DialogDescription>你的工作與應用程式</DialogDescription>
          </DialogHeader>
          <button
            type="button"
            className="wd-mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="關閉選單"
          >
            <X aria-hidden />
          </button>
          <nav className="wd-search-results" aria-label="工作選單">
            {items.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)}>
                <Icon aria-hidden />
                <span>{label}</span>
                <ChevronRight aria-hidden />
              </Link>
            ))}
          </nav>
        </DialogContent>
      </Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="workday-dialog wd-profile-dialog">
          <DialogHeader>
            <DialogTitle>我的帳號</DialogTitle>
            <DialogDescription>
              {user.region} · {user.id}
            </DialogDescription>
          </DialogHeader>
          <div className="wd-profile-info">
            <UserAvatar id={user.id} name={user.name} className="size-12" />
            <strong>{user.name}</strong>
          </div>
          <nav className="wd-search-results" aria-label="帳號功能">
            <Link to="/me" onClick={() => setProfileOpen(false)}>
              <Home aria-hidden />
              <span>個人主頁</span>
              <ChevronRight aria-hidden />
            </Link>
            <Link to="/settings" onClick={() => setProfileOpen(false)}>
              <Settings aria-hidden />
              <span>帳號設定</span>
              <ChevronRight aria-hidden />
            </Link>
          </nav>
          {user.demo && (
            <div className="wd-demo-settings">
              <p>展示身分</p>
              <DemoRoleSwitcher user={user} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WorkdaySidebar({
  user,
  collapsed,
  counts,
  pathname,
  search,
}: {
  user: AuthUser
  collapsed: boolean
  counts: Partial<Record<SidebarBadge, number>>
  pathname: string
  search: string
}) {
  const groups = sidebarItems(user.role)
  return (
    <aside
      id="app-sidebar"
      aria-label="側邊欄"
      className={cn("wd-global-sidebar", collapsed && "is-collapsed")}
    >
      <nav aria-label="主選單">
        <Link
          to="/me"
          className="wd-nav-item is-active"
          aria-current="page"
          title={collapsed ? "個人主頁" : undefined}
        >
          <Home aria-hidden />
          <span className={collapsed ? "sr-only" : ""}>首頁</span>
        </Link>
        <p className="wd-nav-caption">{collapsed ? "" : "工作"}</p>
        {[...groups.main, ...groups.more].map((item, index) => {
          const Icon = item.icon
          const count = item.badge ? (counts[item.badge] ?? 0) : 0
          return (
            <Link
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              aria-current={isActiveItem(item, pathname, search) ? "page" : undefined}
              className={cn("wd-nav-item", index === groups.main.length && "wd-nav-separated")}
            >
              <Icon aria-hidden />
              <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
              {count > 0 && (
                <span className="wd-nav-count" aria-label={`${count} 筆待處理`}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <Link
        to="/settings"
        className="wd-nav-item wd-nav-settings"
        title={collapsed ? "帳號設定" : undefined}
      >
        <Settings aria-hidden />
        <span className={collapsed ? "sr-only" : ""}>帳號設定</span>
      </Link>
    </aside>
  )
}
