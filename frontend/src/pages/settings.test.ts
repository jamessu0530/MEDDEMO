import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type { AccountProfile, AuthUser, Role } from "@/lib/auth"

const state = vi.hoisted(() => ({ user: null as AuthUser | null }))

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => (state.user ? { token: "test", user: state.user } : null),
}))
vi.mock("@/lib/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oauth")>()),
  useProviders: () => ({ google: { client_id: "test-google" }, github: null }),
}))
vi.mock("@/lib/skin", () => ({ useSkin: () => "light" }))
vi.mock("@/lib/text-size", () => ({ useTextSize: () => "standard" }))
vi.mock("@/lib/preferences", () => ({ chooseSkin: vi.fn(), chooseTextSize: vi.fn() }))
vi.mock("@/components/me/personal-memory", () => ({ PersonalMemory: () => null }))
vi.mock("@/components/my-status", () => ({ MyStatusSection: () => null }))
vi.mock("@/components/profile-photo", () => ({ ProfilePhotoSection: () => null }))
vi.mock("@/components/route/location-share", () => ({ LocationShareSection: () => null }))

import { SettingsPage } from "@/pages/settings"

const account: AccountProfile = {
  id: "XJUDGE",
  name: "原登入評審",
  role: "sales",
  region: "北區",
  email: "judge@example.test",
  has_password: true,
  can_rename: true,
  linked: [{ provider: "google", email: "judge-google@example.test", linked_at: "2026-10-17T00:00:00Z" }],
}

function render(role: Role | null, original = account) {
  state.user = role ? {
    id: "DEMO",
    name: "示範人物",
    role,
    region: "南區",
    email: "demo@example.test",
    has_password: true,
    can_rename: false,
    linked: [{ provider: "google", email: "demo-google@example.test", linked_at: "2026-10-17T00:00:00Z" }],
    demo: { account: original, role },
  } : original
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/settings"] }, createElement(SettingsPage)))
}

describe("示範身分的帳號設定", () => {
  it.each<Role>(["sales", "manager", "it"])("%s 可使用設定並管理原登入帳號", (role) => {
    const html = render(role)
    for (const text of ["修改名字", "配色", "字體大小", "綁定的登入方式", "更新密碼", "刪除帳號", "登出"]) {
      expect(html).toContain(text)
    }
    expect(html).toContain("judge@example.test")
    expect(html).toContain("judge-google@example.test")
    expect(html).toContain("原登入帳號「原登入評審」")
    expect(html).not.toContain("demo@example.test")
    expect(html).not.toContain("demo-google@example.test")
    expect(html).not.toContain("示範身分下無法修改")
  })

  it("第三方登入者依自己的密碼狀態顯示設定", () => {
    const html = render("it", { ...account, email: null, has_password: false })
    expect(html).toContain("這個帳號用第三方登入，沒有密碼。")
    expect(html).toContain("judge-google@example.test")
    expect(html).toContain("修改名字")
    expect(html).not.toContain('id="current-password"')
  })

  it("公司帳號在示範模式沿用自己的姓名管理權限", () => {
    const html = render("sales", { ...account, can_rename: false })
    expect(html).toContain("更新密碼")
    expect(html).toContain("綁定的登入方式")
    expect(html).not.toContain("修改名字")
    expect(html).not.toContain("刪除帳號")
  })

  it("沒有切換示範身分時仍顯示自己的設定", () => {
    const html = render(null)
    expect(html).toContain("judge@example.test")
    expect(html).toContain("修改名字")
    expect(html).toContain("更新密碼")
    expect(html).not.toContain("目前示範")
  })
})
