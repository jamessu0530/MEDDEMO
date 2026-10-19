import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  close: vi.fn(),
  dialog: false,
  role: "sales",
  location: {
    pathname: "/calendar",
    search: "?view=week",
    state: { view: "week" },
  },
}))
vi.mock("react-router", () => ({
  useNavigate: () => state.navigate,
  useLocation: () => state.location,
}))
vi.mock("@/ask/assistant-window", () => ({ closeAssistant: state.close }))
vi.mock("@/lib/page-demo-browser", () => ({
  pageDemoTarget: () => (state.dialog ? {} : null),
}))
vi.mock("@/lib/auth", () => ({ readUser: () => ({ role: state.role }) }))

import { useStartUiDemo } from "./use-start-ui-demo"

beforeEach(() => {
  state.navigate.mockReset()
  state.close.mockReset()
  state.dialog = false
  state.role = "sales"
  state.location = {
    pathname: "/calendar",
    search: "?view=week",
    state: { view: "week" },
  }
})

describe("文字要求啟動示範", () => {
  it.each([
    ["/products", "/orders?view=products"],
    ["/products?view=promotions", "/orders?view=promotions"],
    ["/promotions", "/orders?view=promotions"],
  ])("業務從其他頁要求 %s，直接在最終銷售分頁啟動", (path, destination) => {
    useStartUiDemo()("page-tour", path)
    expect(state.navigate).toHaveBeenCalledWith(destination, {
      replace: false,
      state: { startUiDemo: "page-tour" },
    })
  })

  it("主管的型錄維持原本入口", () => {
    state.role = "manager"
    useStartUiDemo()("page-tour", "/products")
    expect(state.navigate).toHaveBeenCalledWith("/products", {
      replace: false,
      state: { startUiDemo: "page-tour" },
    })
  })
  it("直接關閉對話並啟動目前頁面的示範，保留查詢參數與頁面狀態", () => {
    useStartUiDemo()("page-tour", "/calendar?view=week")
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.navigate).toHaveBeenCalledWith("/calendar?view=week", {
      replace: true,
      state: { view: "week", startUiDemo: "page-tour" },
    })
  })

  it("指定其他頁面時前往該頁面，不帶入原頁狀態", () => {
    useStartUiDemo()("page-tour", "/customers")
    expect(state.navigate).toHaveBeenCalledWith("/customers", {
      replace: false,
      state: { startUiDemo: "page-tour" },
    })
  })

  it("訂單示範從其他頁開始時前往訂單頁", () => {
    useStartUiDemo()("create-order")
    expect(state.navigate).toHaveBeenCalledWith("/orders", {
      replace: false,
      state: { startUiDemo: "create-order" },
    })
  })

  it("已有訂單對話框時示範目前對話框", () => {
    state.location = {
      pathname: "/orders",
      search: "",
      state: { view: "week" },
    }
    state.dialog = true
    useStartUiDemo()("create-order")
    expect(state.navigate).toHaveBeenCalledWith("/orders", {
      replace: true,
      state: { view: "week", startUiDemo: "page-tour" },
    })
  })
})
