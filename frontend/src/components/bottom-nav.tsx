import { AudioLines, MessageCircleQuestion, Users } from "lucide-react"
import { NavLink } from "react-router"

import { cn } from "@/lib/utils"

const TABS = [
  { to: "/", label: "拜訪", icon: Users },
  { to: "/ask", label: "問答", icon: MessageCircleQuestion },
  { to: "/voice", label: "語音", icon: AudioLines },
]

/** 底部分頁列：只放在最上層的頁面，進到錄音、確認這些流程裡就不顯示，免得誤觸離開 */
export function BottomNav() {
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
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
