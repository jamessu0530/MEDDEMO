import { useLayoutEffect, useRef } from "react"
import {
  BadgePercent,
  CalendarDays,
  MessageCircleQuestion,
  MessagesSquare,
  Users,
} from "lucide-react"
import { NavLink, useLocation } from "react-router"

import { UnreadDot } from "@/components/channels-link"
import { useChannelUnread } from "@/lib/channel-unread"
import { useUploadQueue } from "@/lib/offline-queue"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/", label: "今日", icon: CalendarDays },
  { to: "/customers", label: "客戶", icon: Users },
  { to: "/channels", label: "頻道", icon: MessagesSquare },
  { to: "/ask", label: "問答", icon: MessageCircleQuestion },
  { to: "/promotions", label: "促銷", icon: BadgePercent },
]

// 膠囊滑動的速度與曲線，跟 CARE 的底部列一樣；字的顏色跟著同一條曲線變
const GLIDE = "duration-400 ease-[cubic-bezier(0.65,0,0.35,1)]"

// 上一頁的膠囊停在第幾格。每個分頁各自畫一條底部列，換頁後新的那一條從這一格滑到自己那一格
let lastIndex: number | null = null

/**
 * 底部分頁列：照 CARE 的樣子，浮在畫面底部的一整條圓角列，目前這一格墊一塊主色的膠囊，換分頁時膠囊滑過去。
 * 只放在最上層的頁面，進到錄音、確認這些流程裡就不顯示，免得誤觸離開。
 * 整條連下面的空隙約 64px（不含 iPhone 的 home indicator），各分頁底下要留至少這麼高。
 */
export function BottomNav() {
  const { items } = useUploadQueue()
  const unread = useChannelUnread()
  const { pathname } = useLocation()
  const pillRef = useRef<HTMLSpanElement>(null)
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([])
  // 第一次畫的時候記下從哪一格來；開發模式的 StrictMode 會把 effect 跑兩次，第二次也要從同一格滑
  const fromRef = useRef(lastIndex)
  // FR-4.3：手機裡還有沒送出的錄音，客戶分頁上顯示筆數（錄音是從客戶清單進去錄的）
  const pending = items.filter((item) => item.state === "pending").length
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  const active = TABS.findIndex((tab) => tab.to === path)

  useLayoutEffect(() => {
    if (active < 0) return
    lastIndex = active
    const from = fromRef.current
    const pill = pillRef.current
    if (!pill || from === null || from === active) return
    const was = linkRefs.current[from]
    const now = linkRefs.current[active]
    // 先擺回上一頁的樣子：膠囊在上一格、上一格是白字、這一格還是灰字（不然字先變白，跟底色混在一起看不到）
    pill.style.transition = "none"
    pill.style.transform = `translateX(${from * 100}%)`
    was?.style.setProperty("color", "var(--primary-foreground)")
    now?.style.setProperty("color", "var(--muted-foreground)")
    // 量一次版面讓瀏覽器記住起點，再拿掉，交給 transition 滑到這一格
    void pill.offsetWidth
    pill.style.transition = ""
    pill.style.transform = `translateX(${active * 100}%)`
    was?.style.removeProperty("color")
    now?.style.removeProperty("color")
  }, [active])

  return (
    // 外層不吃點擊，只有那一條列可以按：列的左右和下面露出來的內容照樣捲得動
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
      <nav className="pointer-events-auto relative flex rounded-full border bg-card p-1 shadow-lg shadow-black/10 dark:shadow-black/50">
        <span
          ref={pillRef}
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/5)] rounded-full bg-primary shadow-md shadow-primary/30 transition-transform motion-reduce:transition-none dark:shadow-black/40",
            GLIDE,
            active < 0 && "hidden"
          )}
          style={{ transform: `translateX(${Math.max(active, 0) * 100}%)` }}
        />
        {TABS.map(({ to, label, icon: Icon }, index) => (
          <NavLink
            key={to}
            ref={(link) => {
              linkRefs.current[index] = link
            }}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                "relative flex h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.72rem] font-semibold transition-colors",
                GLIDE,
                isActive ? "text-primary-foreground" : "text-muted-foreground"
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
              {to === "/channels" && unread > 0 && <UnreadDot count={unread} className="absolute -top-1.5 -right-2.5" />}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
