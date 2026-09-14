import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { Link } from "react-router"

type PageHeaderProps = {
  title: string
  subtitle?: string
  backTo?: string
  // 取代返回鍵的左側按鈕，例如錄音中的「取消」
  leading?: ReactNode
}

export function PageHeader({ title, subtitle, backTo, leading }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-1 py-1.5 backdrop-blur">
      {leading ??
        (backTo ? (
          <Link
            to={backTo}
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
        <h1 className="truncate text-base font-semibold">{title}</h1>
      </div>
    </header>
  )
}
