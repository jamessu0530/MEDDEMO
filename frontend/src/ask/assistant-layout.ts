type Bounds = { top: number; bottom: number }

/** 對話框保留輸入列；向下拉近輸入列時收合，向上拉則限制在可見範圍。 */
export function assistantPanelSize({
  height,
  availableHeight,
  collapsedHeight,
}: {
  height?: number
  availableHeight: number
  collapsedHeight: number
}) {
  const max = Math.max(0, availableHeight - 24)
  // 鍵盤上方的短視窗仍要容納頁首、輸入列與可捲動的紀錄。
  const shortViewport = availableHeight <= 480
  const min = Math.min(max, collapsedHeight + (shortViewport ? 160 : 96))
  return {
    min,
    max,
    height: Math.max(
      min,
      Math.min(
        max,
        height ?? (shortViewport ? max : Math.min(384, availableHeight * 0.55))
      )
    ),
  }
}

export function resizeAssistantPanel({
  height,
  availableHeight,
  collapsedHeight,
  wasOpen = false,
}: {
  height: number
  availableHeight: number
  collapsedHeight: number
  /** 手勢開始時的狀態，避免上拉展開時在最小高度附近反覆開關。 */
  wasOpen?: boolean
}) {
  const size = assistantPanelSize({ height, availableHeight, collapsedHeight })
  return {
    // 展開後往下拉過最小高度就收合，不留下必須一次拉完的空白距離。
    open: height > (wasOpen ? size.min : collapsedHeight + 40),
    height: size.height,
  }
}

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
