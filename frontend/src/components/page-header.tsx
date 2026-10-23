import type { ReactNode } from "react"
import { ChevronLeft } from "@/components/icons"
import { Link } from "react-router"

type PageHeaderProps = {
  title: string
  hideTitle?: boolean
  subtitle?: string
  backTo?: string
  backState?: unknown
  // 取代返回鍵的左側按鈕，例如錄音中的「取消」
  leading?: ReactNode
  // 標頭右側的按鈕，例如主管端的「帳號設定」
  trailing?: ReactNode
}

export function PageHeader({ title, hideTitle = false, subtitle, backTo, backState, leading, trailing }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-1 py-1.5 backdrop-blur">
      {leading ??
        (backTo ? (
          <Link
            to={backTo}
            state={backState}
            aria-label="返回"
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="size-5" />
          </Link>
        ) : (
          <span className="w-3" />
        ))}
      <div className="min-w-0 flex-1 pr-3">
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <h1 className={hideTitle ? "sr-only" : "truncate text-xl font-semibold"}>{title}</h1>
      </div>
      {trailing}
    </header>
  )
}
