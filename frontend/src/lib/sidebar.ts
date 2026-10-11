import {
  Bell,
  BookOpenText,
  Calendar,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileText,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Pill,
  Route,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "@/lib/auth"
import { trimPath } from "@/lib/desktop-layout"

/** 項目旁的數字：待送出的錄音、頻道未讀、主管回覆、風險通報未讀、待簽 */
export type SidebarBadge = "uploads" | "channels" | "replies" | "notices" | "oa"
export type SidebarItem = { to: string; label: string; icon: LucideIcon; badge?: SidebarBadge }
export type SidebarGroups = { main: SidebarItem[]; more: SidebarItem[] }

/** 側邊欄一列的樣子：跟底部分頁列一樣，目前這一列墊主色膠囊 */
export const SIDEBAR_ITEM = "flex min-h-11 w-full items-center gap-3 rounded-full px-4 text-left text-sm font-semibold transition-colors"

// 業務：上面是底部分頁列，下面是手機上擠在首頁頁首的入口
const SALES: SidebarGroups = {
  main: [
    { to: "/", label: "今日", icon: CalendarDays },
    { to: "/customers", label: "客戶", icon: Users, badge: "uploads" },
    { to: "/channels", label: "頻道", icon: MessagesSquare, badge: "channels" },
    { to: "/ask", label: "問答", icon: MessageCircleQuestion },
    { to: "/products", label: "商品與促銷", icon: Pill },
  ],
  more: [
    { to: "/reports", label: "我的報表", icon: ChartNoAxesCombined },
    { to: "/calendar", label: "日曆", icon: Calendar },
    { to: "/methods", label: "方法卡", icon: BookOpenText },
    { to: "/oa/forms", label: "我的申請單", icon: FileText },
    { to: "/escalations", label: "主管回覆", icon: Bell, badge: "replies" },
  ],
}

// 主管端的五個分頁（pages/manager.tsx 的 VIEWS），主管與 IT 共用
const MANAGER: SidebarItem[] = [
  { to: "/manager", label: "團隊行程", icon: Route },
  { to: "/manager?view=asks", label: "提問", icon: MessageCircleQuestion },
  { to: "/manager?view=notices", label: "風險通報", icon: TriangleAlert, badge: "notices" },
  { to: "/manager?view=oa", label: "簽核", icon: ClipboardCheck, badge: "oa" },
  { to: "/manager?view=methods", label: "方法卡", icon: BookOpenText },
]
const CHANNELS: SidebarItem = { to: "/channels", label: "頻道", icon: MessagesSquare, badge: "channels" }
const CATALOG: SidebarItem = { to: "/products", label: "商品與促銷", icon: Pill }
const ADMIN: SidebarItem = { to: "/admin", label: "組織管理", icon: Network }
const MANAGER_VIEWS = ["asks", "notices", "oa", "methods"]

export function sidebarItems(role: Role): SidebarGroups {
  if (role === "sales") return SALES
  return { main: role === "it" ? [ADMIN, ...MANAGER] : MANAGER, more: [{ to: "/reports", label: "我的報表", icon: ChartNoAxesCombined }, CHANNELS, CATALOG] }
}

/** 側邊欄最上面的名字連到哪裡：跟首頁頁首的名字同一個地方。業務是個人頁，主管與 IT 沒有個人頁，是帳號設定 */
export function profilePath(role: Role) {
  return role === "sales" ? "/me" : "/settings"
}

function managerView(query: string) {
  const view = new URLSearchParams(query).get("view") ?? ""
  return MANAGER_VIEWS.includes(view) ? view : "routes"
}

/** 側邊欄哪一列是目前這頁：主管端照 view 判斷（不認得的 view 跟主管端一樣當成團隊行程）；首頁只算 /；
 * 其他是那個網址或它底下的頁（客戶檔案算「客戶」） */
export function isActiveItem(item: SidebarItem, pathname: string, search: string) {
  const path = trimPath(pathname)
  const [itemPath, itemQuery = ""] = item.to.split("?")
  if (itemPath === "/manager") return path === "/manager" && managerView(search) === managerView(itemQuery)
  if (itemPath === "/") return path === "/"
  return path === itemPath || path.startsWith(`${itemPath}/`)
}
