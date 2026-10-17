import type { ReactNode } from "react"
import { FileText } from "@/components/icons"
import { Link } from "react-router"

import { CompanyLogo } from "@/components/company-logo"
import { SkinToggle } from "@/components/skin-toggle"
import { LiveAvatar } from "@/components/user-avatar"
import type { AuthUser } from "@/lib/auth"

/** 業務手機頁首：訂單首頁與路線共用個人頁、申請單與配色入口。 */
export function SalesToolbar({
  user,
  children,
}: {
  user: AuthUser
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 lg:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <CompanyLogo className="w-24" />
        <span className="hidden truncate text-xs text-muted-foreground min-[375px]:block">
          中化裕民
        </span>
      </div>
      <div className="-mr-2 flex shrink-0 items-center">
        {children}
        <Link
          to="/oa/forms"
          aria-label="我的申請單"
          className="flex size-[40px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <FileText className="size-5" />
        </Link>
        <SkinToggle className="size-[40px]" />
        <Link
          to="/me"
          aria-label="個人頁"
          className="flex size-[40px] shrink-0 items-center justify-center rounded-full hover:bg-muted"
        >
          <LiveAvatar id={user.id} name={user.name} />
        </Link>
      </div>
    </div>
  )
}
