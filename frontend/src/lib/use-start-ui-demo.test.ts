import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  close: vi.fn(),
  dialog: false,
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

import { useStartUiDemo } from "./use-start-ui-demo"

beforeEach(() => {
  state.navigate.mockReset()
  state.close.mockReset()
  state.dialog = false
  state.location = {
    pathname: "/calendar",
    search: "?view=week",
    state: { view: "week" },
  }
})

describe("文字要求啟動示範", () => {
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
