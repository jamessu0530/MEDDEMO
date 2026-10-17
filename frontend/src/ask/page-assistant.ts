import { pageWidth, trimPath } from "@/lib/desktop-layout"

/** 每頁都有共用助理；已有輸入列或使用精簡版面的頁面改用浮動入口。 */
export function pageAssistantPlacement(pathname: string) {
  const path = trimPath(pathname)
  if (pageWidth(path) === "bare") return "floating"
  if (path === "/route" || path === "/route/edit" || path === "/reports")
    return "floating"
  if (/^\/channels(?:\/|$)/.test(path)) return "floating"
  return "dock"
}
