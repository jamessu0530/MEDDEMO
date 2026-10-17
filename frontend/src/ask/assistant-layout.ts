type Bounds = { top: number; bottom: number }

/** 固定定位用 layout viewport；可用高度用 visual viewport，包含鍵盤與捲動位移。 */
export function assistantLayout({
  layoutHeight,
  viewport,
  footers = [],
  obstacles = [],
}: {
  layoutHeight: number
  viewport?: { height: number; offsetTop: number } | null
  footers?: Bounds[]
  obstacles?: Bounds[]
}) {
  const top = Math.max(0, viewport?.offsetTop ?? 0)
  let bottom = Math.min(layoutHeight, top + (viewport?.height ?? layoutHeight))
  for (const footer of footers) {
    if (footer.bottom > top && footer.top < bottom)
      bottom = Math.max(top, footer.top)
  }
  // 收合入口才避讓頁面輸入列；展開後由助理自己的輸入列占用可見空間。
  const footerTop = bottom
  for (const obstacle of obstacles) {
    if (
      obstacle.top >= top &&
      obstacle.bottom >= footerTop - 24 &&
      obstacle.top < footerTop
    )
      bottom = Math.min(bottom, Math.max(top, obstacle.top - 8))
  }
  return {
    inset: Math.max(0, layoutHeight - bottom),
    availableHeight: Math.max(0, bottom - top),
  }
}
