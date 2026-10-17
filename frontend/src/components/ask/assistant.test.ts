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
vi.mock("@/ask/use-assistant-inset", () => ({ useAssistantInset: () => 0 }))
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
  it.each([
    "/route",
    "/route/edit",
    "/reports",
    "/channels",
    "/channels/2",
    "/channels/search",
    "/channels/2/threads",
    "/manager?view=priority",
    "/customers/C01/record",
    "/privacy",
    "/auth/google/callback",
  ])("%s 收合時仍顯示入口，展開後可在當頁提問", (path) => {
    const closed = render(path, false)
    expect(closed).toContain('aria-label="開啟 AI 助理"')
    expect(closed).toContain('aria-expanded="false"')
    const opened = render(path, true)
    expect(opened).toContain('aria-label="收起 AI 助理"')
    expect(opened).toContain('aria-expanded="true"')
    expect(opened).toContain('id="page-assistant-input"')
    expect(opened).toContain(`熊熊滾 · ${state.page.title}`)
    expect(opened).not.toContain('id="page-assistant-panel" hidden=""')
  })

  it("一般頁面保留直接輸入的操作方式", () => {
    const html = render("/orders", false)
    expect(html).toContain('data-placement="dock"')
    expect(html).toContain('id="page-assistant-input"')
    expect(html).not.toContain('aria-label="開啟 AI 助理"')
    expect(html).not.toContain('id="page-assistant-panel" hidden=""')
    expect(html).toContain(state.page.hint)
    expect(html).toContain(`placeholder="${state.page.suggestions[0]}"`)
    expect(html).toContain('id="page-assistant-completion"')
    expect(html).toContain("Tab")
    expect(html).toContain("帶入建議")
  })

  it("收到 OA 回覆後，同時在答案後與輸入框提供下一題", () => {
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
    expect(html).toContain('aria-label="接著可以問"')
    expect(html).toContain('placeholder="這張表單怎麼預填？"')
    expect(html).not.toContain("今天需要幫忙什麼？")
    const calendar = render("/calendar", true, true, entries)
    expect(calendar).toContain('placeholder="怎麼新增有提醒的行程？"')
    expect(calendar).not.toContain('aria-label="接著可以問"')
  })

  it("浮動入口收起時也看得到目前頁面的範例", () => {
    const html = render("/reports", false)
    expect(html).toContain("在報表可以問")
    expect(html).toContain("這份報表應該先看哪些數字？")
  })

  it.each([
    "/login",
    "/register",
    "/privacy",
    "/auth/github/callback",
    "/auth/google/callback",
  ])("%s 未登入時有入口及登入說明", (path) => {
    expect(render(path, false, false)).toContain('aria-label="開啟 AI 助理"')
    const opened = render(path, true, false)
    expect(opened).toContain("登入使用 AI 助理")
    expect(opened).toContain('href="/login"')
    expect(opened).not.toContain('id="page-assistant-input"')
  })
})
