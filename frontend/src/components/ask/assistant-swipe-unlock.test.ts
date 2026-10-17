import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AssistantSwipeUnlock } from "@/components/ask/assistant-swipe-unlock"

describe("熊熊滑動解鎖", () => {
  it.each(["ghost", "new"] as const)("%s 顯示跟手進度，取消時保留同一隻熊往回跑", (action) => {
    const moving = renderToStaticMarkup(createElement(AssistantSwipeUnlock, {
      preview: { action, progress: .5, phase: "dragging", retreating: false },
    }))
    expect(moving).toContain('aria-valuenow="50"')
    expect(moving).toContain('data-ready="false"')
    expect(moving).toContain('data-action="' + action + '"')
    expect(moving).toContain("assistant-swipe-runner")
    const returning = renderToStaticMarkup(createElement(AssistantSwipeUnlock, {
      preview: { action, progress: 0, phase: "returning", retreating: true },
    }))
    expect(returning).toContain('data-phase="returning"')
    expect(returning).toContain('data-retreating="true"')
    expect(returning).toContain("assistant-swipe-runner")
    expect(returning).not.toContain("新成就解鎖")
  })
  it("只有滑到底才提示放開切換", () => {
    const html = renderToStaticMarkup(createElement(AssistantSwipeUnlock, {
      preview: { action: "new", progress: 1, phase: "dragging", retreating: false },
    }))
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain("放開新增對話")
  })
})
