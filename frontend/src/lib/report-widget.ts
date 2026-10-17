export type ReportWidgetSize = "small" | "medium" | "large"

/** Read actual space, including narrow canvases and independently sized phones. */
export function reportWidgetSize(
  width: number,
  height: number
): ReportWidgetSize {
  if (width < 260 || height < 280) return "small"
  return height < 560 ? "medium" : "large"
}
