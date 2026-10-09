import { Link } from "react-router"

import { UnreadDot } from "@/components/channels-link"
import { isActiveItem, SIDEBAR_ITEM, type SidebarBadge, type SidebarGroups, type SidebarItem } from "@/lib/sidebar"
import { cn } from "@/lib/utils"

/** 側邊欄的項目：上面一組是主要的頁，分隔線下面是次要的入口。目前這一列墊主色膠囊，有數字的在右邊放紅點 */
export function SidebarNav({
  groups,
  counts,
  pathname,
  search,
}: {
  groups: SidebarGroups
  counts: Partial<Record<SidebarBadge, number>>
  pathname: string
  search: string
}) {
  const row = (item: SidebarItem) => {
    const active = isActiveItem(item, pathname, search)
    const count = item.badge ? (counts[item.badge] ?? 0) : 0
    const Icon = item.icon
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={cn(
          SIDEBAR_ITEM,
          active ? "bg-primary text-primary-foreground shadow-lip-primary" : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Icon className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count > 0 && <UnreadDot count={count} />}
      </Link>
    )
  }
  return (
    <nav aria-label="主選單" className="flex flex-col gap-1">
      {groups.main.map(row)}
      <hr className="mx-3 my-2 border-t-2" />
      {groups.more.map(row)}
    </nav>
  )
}
