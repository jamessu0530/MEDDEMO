import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  vi.stubGlobal("document", { documentElement: { dataset: {} } })
})

afterEach(() => vi.unstubAllGlobals())

describe("電腦版側邊欄收合", () => {
  it("第一次展開，收合後所有版面共用狀態，重新載入仍記得", async () => {
    let sidebar = await import("@/lib/desktop-sidebar")
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false")
    sidebar.setSidebarCollapsed(true)
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("true")
    expect(localStorage.getItem("meddemo:sidebar-collapsed")).toBe("1")

    vi.resetModules()
    sidebar = await import("@/lib/desktop-sidebar")
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("true")
    sidebar.setSidebarCollapsed(false)
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false")
    expect(localStorage.getItem("meddemo:sidebar-collapsed")).toBe("0")
  })

  it("網站資料無法讀寫時仍能來回切換", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked") },
      setItem: () => { throw new Error("blocked") },
    })
    const sidebar = await import("@/lib/desktop-sidebar")
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false")
    sidebar.setSidebarCollapsed(true)
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("true")
    sidebar.setSidebarCollapsed(false)
    expect(document.documentElement.dataset.sidebarCollapsed).toBe("false")
  })
})
