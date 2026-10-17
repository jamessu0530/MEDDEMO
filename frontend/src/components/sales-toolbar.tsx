import type { ReactNode } from "react"
import { Bell, ChevronRight, FileText } from "@/components/icons"
import { Link } from "react-router"

import { CompanyLogo } from "@/components/company-logo"
import { MyStatusButton } from "@/components/my-status"
import { SkinToggle } from "@/components/skin-toggle"
import type { AuthUser } from "@/lib/auth"
import { useUnseenReplies } from "@/lib/manager-replies"
import { cn } from "@/lib/utils"

/** 業務手機頁首：訂單首頁與路線共用個人頁、主管回覆、申請單與配色入口。 */
export function SalesToolbar({ user, children }: { user: AuthUser; children?: ReactNode }) {
  const unseen = useUnseenReplies()
  return (
    <div className="flex flex-col gap-2 lg:hidden">
      <div className="flex items-center gap-2">
        <CompanyLogo className="w-24" />
        <span className="text-xs text-muted-foreground">中化裕民</span>
      </div>
      <div className="-mr-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <MyStatusButton className="size-9" />
          <Link to="/me" className="flex h-11 min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">{user.name}</span>
              <span className="truncate">
                {user.region}
                {user.acting_as && ` · 共用：${user.acting_as.name}的客戶`}
              </span>
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
        </div>
        <div className="flex shrink-0 items-center">
          {children}
          <Link
            to="/escalations"
            aria-label={unseen > 0 ? `主管回覆 ${unseen} 則，查看` : "轉給主管的提問"}
            className="flex h-[40px] min-w-[40px] items-center justify-center gap-1 rounded-lg px-1.5 hover:bg-muted"
          >
            <Bell data-icon-attention={unseen > 0 ? "true" : undefined} className={cn("size-5", unseen > 0 ? "fill-warning text-warning" : "text-muted-foreground")} />
            {unseen > 0 && <span className="text-sm font-semibold text-warning tabular-nums">{unseen}</span>}
          </Link>
          <Link
            to="/oa/forms"
            aria-label="我的申請單"
            className="flex size-[40px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <FileText className="size-5" />
          </Link>
          <SkinToggle className="size-[40px]" />
        </div>
      </div>
    </div>
  )
}
