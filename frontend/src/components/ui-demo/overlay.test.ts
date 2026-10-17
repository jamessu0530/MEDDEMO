import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { UiDemoPointer } from "@/components/ui-demo/overlay"
import type { DemoState } from "@/lib/ui-demo"

const state: DemoState = {
  kind: "create-order", runId: 1, pageKey: "/orders", total: 11, status: "running",
  step: 1, text: "按新增訂單", rect: { x: 10, y: 20, width: 50, height: 40 }, clicking: true,
}
describe("示範指標", () => {
  it("直接顯示會點擊的指標與兩下接手提示，不放提示卡或停止按鈕", () => {
    const html = renderToStaticMarkup(createElement(UiDemoPointer, { state }))
    expect(html).toContain("ui-demo-pointer-click")
    expect(html).toContain("熊熊滾 · 點兩下接手")
    expect(html).not.toContain("ui-demo-card")
    expect(html).not.toContain("<button")
  })
  it.each(["idle", "stopped", "completed", "failed"] as const)("%s 直接回到原畫面，不顯示停止或結果頁", (status) => {
    expect(renderToStaticMarkup(createElement(UiDemoPointer, { state: { ...state, status } }))).toBe("")
  })
})
