type Bounds = { top: number; bottom: number }

/** 固定定位用 layout viewport；可用高度用 visual viewport，包含鍵盤與捲動位移。 */
export function assistantLayout({
  layoutHeight,
  viewport,
  footers = [],
}: {
  layoutHeight: number
  viewport?: { height: number; offsetTop: number } | null
  footers?: Bounds[]
}) {
  const top = Math.max(0, viewport?.offsetTop ?? 0)
  let bottom = Math.min(layoutHeight, top + (viewport?.height ?? layoutHeight))
  for (const footer of footers) {
    if (footer.bottom > top && footer.top < bottom)
      bottom = Math.max(top, footer.top)
  }
  return {
    inset: Math.max(0, layoutHeight - bottom),
    availableHeight: Math.max(0, bottom - top),
  }
}
