import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  askPriorityAdvice,
  type PriorityAdvice,
  type PriorityStrategy,
} from "@/api/customer-priority"
import { createCustomerPriorityAssistant } from "@/ask/customer-priority-assistant"
import { strategyFingerprint } from "@/lib/customer-priority"

vi.mock("@/api/customer-priority", () => ({ askPriorityAdvice: vi.fn() }))
const ask = vi.mocked(askPriorityAdvice)
const strategy: PriorityStrategy = {
  id: "balanced",
  name: "均衡經營",
  days: 90,
  daily_limit: 5,
  metrics: [{ metric: "revenue", weight: 1, direction: "higher" }],
  priority_customers: [{ customer_id: "C01", reason: "合約續約", until: null }],
}
const advice: PriorityAdvice = {
  kind: "suggestion",
  message: "提高淨毛利的比重。",
  strategy: {
    ...strategy,
    name: "淨毛利經營",
    metrics: [{ metric: "net_margin", weight: 1, direction: "higher" }],
  },
  source: "ai",
  context: {
    date: "2026-10-17",
    days: 90,
    customers: 12,
    customers_with_revenue: 10,
    growth_available: 8,
    declining_customers: 2,
    missing_purchase_history: 2,
    missing_visit_history: 1,
  },
}
const page = { path: "/manager?view=priority", title: "客戶策略", facts: [] }
const editor = (onUse = vi.fn()) => ({
  managerId: "M01",
  strategy,
  disabled: false,
  onUse,
})
beforeEach(() => ask.mockReset().mockResolvedValue(advice))

describe("共用助理的客戶優先策略", () => {
  it("只在策略頁處理經營目標與指標解釋，一般數字問題仍走查詢", () => {
    const assistant = createCustomerPriorityAssistant()
    expect(assistant.handles("幫我調整權重", page)).toBe(false)
    const binding = assistant.connect(editor())
    for (const question of [
      "幫我調整權重",
      "營收和成長差在哪？",
      "先照顧很久沒來往的客戶",
    ])
      expect(assistant.handles(question, page)).toBe(true)
    expect(assistant.handles("團隊營收多少？", page)).toBe(false)
    expect(
      assistant.handles("調整權重", { ...page, path: "/manager?view=routes" })
    ).toBe(false)
    expect(assistant.handles("調整權重", { ...page, path: "/orders" })).toBe(
      false
    )
    binding.disconnect()
    expect(assistant.handles("調整權重", page)).toBe(false)
  })

  it("先回覆與比較，按帶入才更新一次草稿，保留指定客戶與策略編號", async () => {
    const assistant = createCustomerPriorityAssistant()
    const onUse = vi.fn()
    assistant.connect(editor(onUse))
    ask.mockResolvedValueOnce({
      ...advice,
      strategy: { ...advice.strategy!, id: "other", priority_customers: [] },
    })
    expect(await assistant.ask("優先淨毛利")).toBe(advice.message)
    expect(onUse).not.toHaveBeenCalled()
    expect(assistant.getSnapshot().proposal?.base).toEqual(strategy)
    assistant.apply()
    assistant.apply()
    expect(onUse).toHaveBeenCalledExactlyOnceWith(
      {
        ...advice.strategy,
        id: strategy.id,
        priority_customers: strategy.priority_customers,
      },
      strategyFingerprint("M01", strategy)
    )
  })

  it("追問帶上策略對話，明確的情境起點才使用預設建議", async () => {
    const assistant = createCustomerPriorityAssistant()
    assistant.connect(editor())
    await assistant.ask("先給我均衡起點")
    expect(ask.mock.calls[0][4]).toBe("balanced")
    await assistant.ask("再多一點毛利")
    expect(ask.mock.calls[1][3]).toMatchObject([
      { role: "user", content: "先給我均衡起點" },
      { role: "assistant", content: expect.stringContaining("提高淨毛利") },
    ])
    expect(ask.mock.calls[1][4]).toBeUndefined()
  })

  it("保留原設定、手動修改與離開頁面都使舊建議失效", async () => {
    const assistant = createCustomerPriorityAssistant()
    const current = editor()
    const binding = assistant.connect(current)
    await assistant.ask("調整權重")
    assistant.dismiss()
    assistant.apply()
    await assistant.ask("調整權重")
    binding.update({ ...current, strategy: { ...strategy, days: 120 } })
    assistant.apply()
    await assistant.ask("調整權重")
    binding.disconnect()
    assistant.apply()
    expect(current.onUse).not.toHaveBeenCalled()
    expect(assistant.getSnapshot().proposal).toBeNull()
  })

  it.each(["manager", "strategy", "leave"])(
    "%s 變更會取消請求，遲到的回覆不能套用",
    async (change) => {
      let resolve!: (value: PriorityAdvice) => void
      ask.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      const assistant = createCustomerPriorityAssistant()
      const current = editor()
      const old = assistant.connect(current)
      const pending = assistant.ask("優先毛利")
      const signal = ask.mock.calls[0][5]!
      if (change === "leave") old.disconnect()
      else {
        assistant.connect({
          ...current,
          managerId: change === "manager" ? "M02" : "M01",
          strategy:
            change === "strategy" ? { ...strategy, id: "new" } : strategy,
        })
        old.disconnect()
      }
      expect(signal.aborted).toBe(true)
      resolve(advice)
      expect(await pending).toContain("客戶策略已變更")
      expect(assistant.getSnapshot()).toMatchObject({
        busy: false,
        proposal: null,
      })
      assistant.apply()
      expect(current.onUse).not.toHaveBeenCalled()
    }
  )

  it("忙碌時不能帶入建議，解釋與釐清不建立可套用的設定", async () => {
    const assistant = createCustomerPriorityAssistant()
    const current = editor()
    const binding = assistant.connect(current)
    await assistant.ask("調整權重")
    binding.update({ ...current, disabled: true })
    assistant.apply()
    expect(current.onUse).not.toHaveBeenCalled()
    expect(await assistant.ask("調整權重")).toContain("先完成")
    expect(ask).toHaveBeenCalledTimes(1)
    binding.update(current)
    ask.mockResolvedValueOnce({ ...advice, kind: "clarify", strategy: null })
    await assistant.ask("幫我調整權重")
    expect(assistant.getSnapshot().proposal).toBeNull()
    expect(assistant.handles("維持現在的站數", page)).toBe(true)
  })
})
