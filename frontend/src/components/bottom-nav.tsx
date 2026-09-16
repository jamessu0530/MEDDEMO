import { AudioLines, CalendarDays, MessageCircleQuestion, Users } from "lucide-react"
import { NavLink } from "react-router"

import { useUploadQueue } from "@/lib/offline-queue"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/", label: "今日", icon: CalendarDays },
  { to: "/customers", label: "客戶", icon: Users },
  { to: "/ask", label: "問答", icon: MessageCircleQuestion },
  { to: "/voice", label: "語音", icon: AudioLines },
]

/** 底部分頁列：只放在最上層的頁面，進到錄音、確認這些流程裡就不顯示，免得誤觸離開 */
export function BottomNav() {
  const { items } = useUploadQueue()
  // FR-4.3：手機裡還有沒送出的錄音，客戶分頁上顯示筆數（錄音是從客戶清單進去錄的）
  const pending = items.filter((item) => item.state === "pending").length
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md border-t bg-card pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs",
              isActive ? "font-medium text-primary" : "text-muted-foreground"
            )
          }
        >
          <span className="relative">
            <Icon className="size-5" />
            {to === "/customers" && pending > 0 && (
              <span
                aria-label={`待送出 ${pending} 筆`}
                className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
              >
                {pending}
              </span>
            )}
          </span>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
