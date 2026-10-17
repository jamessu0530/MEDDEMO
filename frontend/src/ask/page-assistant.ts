import { trimPath } from "@/lib/desktop-layout"

/** 路線頁保留原有的 AI 輸入列；其他頁使用共用助理。 */
export function pageAssistantPlacement(pathname: string) {
  const path = trimPath(pathname)
  if (path === "/route" || path === "/route/edit") return "none"
  return "dock"
}
