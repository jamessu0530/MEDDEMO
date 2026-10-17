import { VISUALS, type ReportVisual } from "@/lib/reports"

export type ReportWidgetSize = "small" | "medium" | "large"

export const REPORT_WIDGET_PRESETS = {
  small: { label: "小", w: 6, h: 10 },
  medium: { label: "中", w: 12, h: 18 },
  large: { label: "大", w: 24, h: 28 },
} as const

export function reportWidgetDescription(
  visual: ReportVisual,
  size: ReportWidgetSize
) {
  if (size === "small")
    return { title: "數字摘要", detail: "重點數字、比較摘要與目標進度" }
  if (visual === "kpi")
    return size === "medium"
      ? { title: "指標與進度", detail: "重點數字、比較摘要與目標達成率" }
      : { title: "完整指標", detail: "精確數字、比較日期、目標與資料說明" }
  return size === "medium"
    ? { title: VISUALS[visual], detail: "重點數字、主圖與比較摘要" }
    : {
        title: `${VISUALS[visual]}與明細`,
        detail: "主圖、比較日期、分組數值與資料說明",
      }
}

/** Read actual space, including narrow canvases and independently sized phones. */
export function reportWidgetSize(
  width: number,
  height: number
): ReportWidgetSize {
  if (width < 200 || height < 280) return "small"
  return height < 560 ? "medium" : "large"
}
