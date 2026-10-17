import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { UnlockToast } from "@/components/route/unlock-toast"

describe("UnlockToast", () => {
  it("寫解鎖了哪一面，點了進個人頁", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(UnlockToast, {
          medals: [
            { kind: "stores", tier: 2, need: 3, have: 3, unlocked_on: "2026-10-28", unlocked_at: "2026-10-28T09:18:00+08:00" },
          ],
          onDone: () => {},
        })
      )
    )
    expect(html).toContain("解鎖銀牌：跑過 3 家藥局")
    expect(html).toContain('href="/me"')
    expect(html).toContain('role="status"')
    // 電腦版對齊路線欄，寬度跟著首頁的並排／單欄切換
    expect(html).toContain("lg:left-[calc(var(--app-sidebar-width)+1.5rem)]")
    expect(html).toContain("lg:w-[var(--home-route-width,27.5rem)]")
  })
})
