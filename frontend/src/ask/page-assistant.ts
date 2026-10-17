import { pageWidth, trimPath } from "@/lib/desktop-layout"

/** 路線、報表與頻道沿用自己的輸入方式，錄音流程保持專注。 */
export function hasPageAssistant(pathname: string, search = "") {
  const path = trimPath(pathname)
  if (pageWidth(path) === "bare") return false
  if (path === "/route" || path === "/route/edit" || path === "/reports")
    return false
  if (/^\/channels(?:\/|$)/.test(path)) return false
  if (
    path === "/manager" &&
    new URLSearchParams(search).get("view") === "priority"
  )
    return false
  return true
}
