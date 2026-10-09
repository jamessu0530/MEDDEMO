import type { ReactNode } from "react"
import { useLocation } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import type { AuthUser } from "@/lib/auth"
import { pageWidth } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

/**
 * 登入之後的外框。手機上什麼都不加；電腦版左邊一條側邊欄，內容照 pageWidth 放：
 * 寬版的頁自己排、其他頁放在中間一欄；錄音頁不畫側邊欄，照手機的寬度置中。
 * 在 <Routes> 裡面，換頁時墨還沒蓋滿拿到的是舊的那一頁，寬度跟著畫面一起換
 */
export function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const width = pageWidth(useLocation().pathname)
  if (width === "bare") return <div className="lg:mx-auto lg:max-w-md">{children}</div>
  return (
    <>
      <AppSidebar user={user} />
      <div className="lg:pl-56">
        <div className={cn(width === "column" && "lg:mx-auto lg:max-w-2xl")}>{children}</div>
      </div>
    </>
  )
}
