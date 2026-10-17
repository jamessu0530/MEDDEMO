import { trimPath } from "@/lib/desktop-layout"

/** 路線頁保留原有的 AI 輸入列；頻道內透過 @熊熊滾 提問；其他頁使用共用助理。 */
export function pageAssistantPlacement(pathname: string) {
  const path = trimPath(pathname)
  if (path === "/route" || path === "/route/edit") return "none"
  if (path === "/channels" || path.startsWith("/channels/")) return "none"
  return "dock"
}
