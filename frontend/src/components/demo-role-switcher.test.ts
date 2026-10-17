import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DemoRoleSwitcher } from "./demo-role-switcher"
import type { AuthUser } from "@/lib/auth"

const account: AuthUser = {
  id: "XJAMES", name: "james su", role: "sales", region: "北區", email: null,
}

describe("角色切換列", () => {
  it("只顯示業務、主管、it 三個按鈕，登入後原角色也有選取狀態", () => {
    const user = { ...account, demo: { account, role: null } }
    const html = renderToStaticMarkup(createElement(DemoRoleSwitcher, { user }))
    expect(html.replace(/<[^>]*>/g, "")).toBe("業務主管it")
    expect(html.match(/<button\b/g)).toHaveLength(3)
    expect(html).toMatch(/aria-pressed="true"[^>]*>業務<\/button>/)
  })

  it("切換後標示目前角色", () => {
    const user: AuthUser = { ...account, role: "manager", demo: { account, role: "manager" } }
    const html = renderToStaticMarkup(createElement(DemoRoleSwitcher, { user }))
    expect(html).toMatch(/aria-pressed="true"[^>]*>主管<\/button>/)
    expect(html.replace(/<[^>]*>/g, "")).toBe("業務主管it")
  })

  it("未開放切換時隱藏", () => {
    expect(renderToStaticMarkup(createElement(DemoRoleSwitcher, { user: account }))).toBe("")
  })
})
