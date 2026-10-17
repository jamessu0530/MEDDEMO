import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AccountProfile, AuthUser, Role } from "./auth"

const account: AccountProfile = {
  id: "XJAMES",
  name: "james su",
  role: "sales",
  region: "北區",
  email: "james@example.test",
}

function legacyUser(role: Role): AuthUser {
  return {
    id: "M01",
    name: "陳建宏",
    role,
    region: "示範區",
    email: "demo@example.test",
    demo: { account, role },
  }
}

beforeEach(() => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("角色切換保留登入者本人", () => {
  it.each<Role>(["sales", "manager", "it"])("舊快取的 %s 身分立即顯示本人", async (role) => {
    localStorage.setItem("meddemo:token", "existing-token")
    localStorage.setItem("meddemo:user", JSON.stringify(legacyUser(role)))
    const { readUser, readToken } = await import("./auth")
    expect(readUser()).toMatchObject({ ...account, role })
    expect(readToken()).toBe("existing-token")
  })

  it("切換與重新整理身分都使用本人的姓名與工號", async () => {
    const { signIn, refreshUser, readUser } = await import("./auth")
    signIn({ token: "token", user: legacyUser("manager") })
    expect(readUser()).toMatchObject({ ...account, role: "manager" })
    expect(JSON.parse(localStorage.getItem("meddemo:user")!)).toMatchObject({ ...account, role: "manager" })
    refreshUser(legacyUser("it"))
    expect(readUser()).toMatchObject({ ...account, role: "it" })
  })

  it("一般登入保留原帳號資料", async () => {
    const { signIn, readUser } = await import("./auth")
    signIn({ token: "token", user: account })
    expect(readUser()).toEqual(account)
  })
})
