import { afterEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({ user: "U1", change: () => {} }))
vi.mock("@/lib/auth", () => ({
  readUser: () => ({ id: auth.user }),
  onAuthChange: (listener: () => void) => { auth.change = listener },
}))

import { assistantVoice, closeAssistantVoice, openAssistantVoice } from "@/ask/assistant-voice"

afterEach(() => { closeAssistantVoice(); auth.user = "U1"; auth.change() })

describe("全站語音連線狀態", () => {
  it("共用同一個語音會話，再按入口不重建或清除會話", () => {
    openAssistantVoice()
    const session = { sendText: vi.fn(), noteActivity: vi.fn() }
    assistantVoice.setSession(session)
    const before = assistantVoice.getSnapshot()
    openAssistantVoice()
    expect(assistantVoice.getSnapshot()).toBe(before)
    expect(assistantVoice.getSnapshot().session).toBe(session)
    closeAssistantVoice()
    expect(assistantVoice.getSnapshot()).toEqual({ active: false, session: null, notice: null })
  })

  it("重新整理相同帳號資料不掛斷，切換帳號則釋放語音", () => {
    openAssistantVoice()
    assistantVoice.setSession({ sendText: vi.fn(), noteActivity: vi.fn() })
    auth.change()
    expect(assistantVoice.getSnapshot().active).toBe(true)
    auth.user = "U2"
    auth.change()
    expect(assistantVoice.getSnapshot()).toEqual({ active: false, session: null, notice: null })
  })
})
