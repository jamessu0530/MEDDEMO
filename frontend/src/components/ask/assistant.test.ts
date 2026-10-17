import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { pageContextFor } from "@/ask/page-context"
import type { Entry } from "@/ask/conversation"
import type { AuthUser } from "@/lib/auth"

const state = vi.hoisted(() => ({
  open: false,
  user: null as AuthUser | null,
  entries: [] as Entry[],
  page: {
    path: "/",
    title: "目前頁面",
    facts: [] as string[],
    suggestions: [] as string[],
    hint: "",
    followUps: [] as string[],
  },
}))
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => (state.user ? { token: "test", user: state.user } : null),
}))
vi.mock("@/ask/assistant-window", () => ({
  assistantWindow: { subscribe: () => () => {}, getSnapshot: () => state.open },
  openAssistant: vi.fn(),
  closeAssistant: vi.fn(),
}))
vi.mock("@/ask/use-assistant-layout", () => ({
  useAssistantLayout: () => ({ inset: 428, availableHeight: 320 }),
}))
vi.mock("@/ask/use-page-context", () => ({
  useCurrentPageContext: () => state.page,
}))
vi.mock("@/ask/ask-session", () => ({
  askSessionFor: () => ({
    conversation: {},
    subscribe: () => () => {},
    isBusy: () => false,
  }),
}))
vi.mock("@/ask/use-conversation", () => ({
  useConversation: () => state.entries,
}))
vi.mock("@/components/ask/entry-view", () => ({ EntryView: () => null }))
vi.mock("@/components/mascot", () => ({ Mascot: () => null }))

import { Assistant } from "@/components/ask/assistant"

function render(
  path: string,
  open: boolean,
  signedIn = true,
  entries: Entry[] = []
) {
  state.open = open
  state.entries = entries
  state.user = signedIn
    ? { id: "M01", name: "主管", role: "manager", region: "北區", email: null }
    : null
  const url = new URL(path, "https://meddemo.test")
  state.page = pageContextFor(url.pathname, url.search)
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Assistant)
    )
  )
}

describe("所有頁面的共用 AI 助理", () => {
  it.each(["/route", "/route/", "/route/edit", "/route/edit/"])(
    "%s 使用原有 AI 輸入列，不顯示第二個助理",
    (path) => {
      expect(render(path, false)).toBe("")
      expect(render(path, true)).toBe("")
    }
  )

  it.each([
    "/reports",
    "/channels",
    "/channels/2",
    "/channels/search",
    "/channels/2/threads",
    "/customers/C01/record",
    "/privacy",
    "/auth/google/callback",
  ])("%s 收合只隱藏回覆，保留可直接輸入的底部詢問欄", (path) => {
    const closed = render(path, false)
    expect(closed).toContain('data-placement="dock"')
    expect(closed).toContain('id="page-assistant-input"')
    expect(closed).toContain('aria-label="展開共用對話"')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).toContain('id="page-assistant-answers" hidden=""')
    expect(closed).not.toContain('id="page-assistant-panel" hidden=""')
    expect(closed).not.toContain('aria-label="開啟 AI 助理"')
    const opened = render(path, true)
    expect(opened).toContain('aria-label="收起 AI 回覆"')
    expect(opened).not.toContain('id="page-assistant-launcher"')
    expect(opened).toContain('aria-expanded="true"')
    expect(opened).toContain('id="page-assistant-input"')
    expect(opened).toContain(`熊熊滾 · ${state.page.title}`)
    expect(opened).not.toContain('id="page-assistant-panel" hidden=""')
  })

  it.each([
    "/orders",
    "/manager",
    "/manager?view=priority",
    "/manager?view=asks",
    "/manager?view=oa",
    "/manager?view=methods",
  ])("%s 使用相同的底部詢問欄，可直接輸入", (path) => {
    const html = render(path, false)
    expect(html).toContain('data-placement="dock"')
    expect(html).toContain('id="page-assistant-input"')
    expect(html).not.toContain('aria-label="開啟 AI 助理"')
    expect(html).not.toContain('id="page-assistant-panel" hidden=""')
    expect(html).toContain('placeholder="輸入問題…"')
    expect(html).not.toContain(state.page.hint)
    expect(html).not.toContain('id="page-assistant-completion"')
    expect(html).not.toContain("Tab")
    expect(html).not.toContain("帶入建議")
    expect(html).not.toContain("操作給我看")
  })

  it("收到回覆後保留純對話，不再塞入追問按鈕", () => {
    const page = pageContextFor("/oa/new/6071")
    const entries: Entry[] = [
      {
        id: 1,
        kind: "user",
        source: "typed",
        text: "這張表單還缺什麼資料？",
        page,
      },
      { id: 2, kind: "model", source: "typed", text: "還缺申請目的。", page },
    ]
    const html = render(page.path, true, true, entries)
    expect(html).not.toContain('aria-label="接著可以問"')
    expect(html).toContain('placeholder="輸入問題…"')
    expect(html).not.toContain("操作給我看")
    expect(html).not.toContain("今天需要幫忙什麼？")
    const calendar = render("/calendar", true, true, entries)
    expect(calendar).toContain('placeholder="輸入問題…"')
    expect(calendar).not.toContain('aria-label="接著可以問"')
  })

  it("報表收合時保持輸入欄，不顯示浮動按鈕或額外提示", () => {
    const html = render("/reports", false)
    expect(html).toContain('id="page-assistant-input"')
    expect(html).not.toContain('id="page-assistant-launcher"')
    expect(html).not.toContain("在報表可以問")
    expect(html).not.toContain("這份報表應該先看哪些數字？")
  })

  it("底部面板與輸入欄整體依鍵盤上方可見空間縮小", () => {
    const html = render("/channels/2", true)
    expect(html).toContain("bottom:428px")
    expect(html).toContain(
      "calc(320px - max(env(safe-area-inset-top), 0.5rem))"
    )
    expect(html).not.toContain("100dvh - 428px")
  })

  it.each([
    "/login",
    "/register",
    "/privacy",
    "/auth/github/callback",
    "/auth/google/callback",
  ])("%s 未登入時直接顯示底部登入列", (path) => {
    const closed = render(path, false, false)
    expect(closed).toContain('data-placement="dock"')
    expect(closed).toContain('aria-label="AI 助理登入提示"')
    expect(closed).toContain("登入提問")
    expect(closed).not.toContain('id="page-assistant-launcher"')
    expect(closed).not.toContain('id="page-assistant-panel" hidden=""')
    const opened = render(path, true, false)
    expect(opened).toContain('aria-label="收起 AI 回覆"')
    expect(opened).toContain("登入後就能問熊熊滾")
    expect(opened).toContain('href="/login"')
    expect(opened).not.toContain('id="page-assistant-input"')
  })
})
