import type { ReactNode } from "react"
import { useLocation } from "react-router"

import { WorkdayHeader } from "@/components/me/workday-chrome"
import { AppSidebar } from "@/components/app-sidebar"
import { pageAssistantPlacement } from "@/ask/page-assistant"
import { DemoRoleSwitcher } from "@/components/demo-role-switcher"
import type { AuthUser } from "@/lib/auth"
import { pageWidth, trimPath } from "@/lib/desktop-layout"
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/desktop-sidebar"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

/**
 * 登入之後的外框。手機上什麼都不加；電腦版左邊一條側邊欄，內容照 pageWidth 放：
 * 寬版的頁自己排、其他頁放在中間一欄；錄音頁不畫側邊欄，照手機的寬度置中。
 * 在 <Routes> 裡面，換頁時墨還沒蓋滿拿到的是舊的那一頁，寬度跟著畫面一起換
 */
export function AppShell({
  user,
  children,
}: {
  user: AuthUser
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const width = pageWidth(pathname)
  const desktop = useIsDesktop()
  const collapsed = useSidebarCollapsed()
  const bare = width === "bare"
  const workday = trimPath(pathname) === "/me"
  // 錄音頁也保留同一層外框，避免切換時把保留中的報表工作區一起卸載。
  return (
    <div className={workday ? "workday-workspace" : undefined}>
      {workday && <WorkdayHeader user={user} collapsed={collapsed} onToggle={() => setSidebarCollapsed(!collapsed)} />}
      {/* 手機上整條側邊欄是隱藏的，不要掛上去，免得它的計數器還在背景一直抓資料 */}
      {desktop && !bare && (
        <AppSidebar
          user={user}
          appearance={workday ? "workday" : undefined}
          collapsed={collapsed}
          onToggle={() => setSidebarCollapsed(!collapsed)}
        />
      )}
      <div className={cn("wd-app-main", bare ? "lg:mx-auto lg:max-w-md" : "lg:pl-[var(--app-sidebar-width)]")}>
        {!bare && !workday && <DemoRoleSwitcher user={user} />}
        <div
          data-ui-demo-page
          className={cn(
            width === "column" && "lg:mx-auto lg:max-w-2xl",
            pageAssistantPlacement(pathname) === "dock" && !workday && "pb-[var(--page-assistant-dock-space,5rem)]"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
