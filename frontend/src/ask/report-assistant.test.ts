import { beforeEach, describe, expect, it, vi } from "vitest"
import { adjustReport, type ReportAdjustment } from "@/api/reports"
import { createReportAssistant } from "@/ask/report-assistant"
import type { ReportConfig } from "@/lib/reports"

vi.mock("@/api/reports", () => ({ adjustReport: vi.fn() }))
const adjust = vi.mocked(adjustReport)
const config: ReportConfig = {
  name: "我的報表",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  cards: [],
}
const proposal = {
  kind: "proposal",
  message: "已改為近六個月。",
  config: { ...config, period: "six_months" },
} satisfies ReportAdjustment
const page = { path: "/reports", title: "我的報表", facts: [] }
beforeEach(() => adjust.mockReset().mockResolvedValue(proposal))

describe("共用助理的報表調整", () => {
  it("只在報表編輯中接收調整，一般數字問題與其他頁維持查詢", () => {
    const assistant = createReportAssistant()
    expect(assistant.handles("調整成近六個月", page)).toBe(false)
    const binding = assistant.connect({
      config,
      available: true,
      onApply: vi.fn(),
    })
    expect(assistant.handles("調整成近六個月", page)).toBe(true)
    expect(assistant.handles("新增銷售趨勢圖", page)).toBe(true)
    expect(assistant.handles("本月銷售金額多少？", page)).toBe(false)
    expect(
      assistant.handles("新增銷售趨勢圖", { ...page, path: "/orders" })
    ).toBe(false)
    binding.disconnect()
    expect(assistant.handles("調整成近六個月", page)).toBe(false)
  })
  it("先預覽、可接續修改，只有套用才更新原稿且只套用一次", async () => {
    const assistant = createReportAssistant()
    const onApply = vi.fn()
    assistant.connect({ config, available: true, onApply })
    expect(await assistant.ask("調整成近六個月")).toBe(proposal.message)
    expect(onApply).not.toHaveBeenCalled()
    expect(assistant.handles("本月銷售金額多少？", page)).toBe(false)
    await assistant.ask("再改報表名稱")
    expect(adjust.mock.calls[1][1]).toEqual(proposal.config)
    assistant.apply()
    assistant.apply()
    expect(onApply).toHaveBeenCalledExactlyOnceWith(proposal.config)
    expect(assistant.getSnapshot().proposal).toBeNull()
  })
  it("保留原版、修改草稿與關閉編輯後都不能套用舊建議", async () => {
    const assistant = createReportAssistant()
    const onApply = vi.fn()
    const binding = assistant.connect({ config, available: true, onApply })
    await assistant.ask("調整期間")
    assistant.dismiss()
    assistant.apply()
    await assistant.ask("調整期間")
    binding.update({
      config: { ...config, name: "手動改名" },
      available: true,
      onApply,
    })
    assistant.apply()
    await assistant.ask("調整期間")
    binding.disconnect()
    assistant.apply()
    expect(onApply).not.toHaveBeenCalled()
  })
  it("編輯時切換報表會取消請求，遲到的回應不能套到新報表", async () => {
    let resolve!: (result: ReportAdjustment) => void
    adjust.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const assistant = createReportAssistant()
    const old = assistant.connect({
      config,
      available: true,
      onApply: vi.fn(),
    })
    const pending = assistant.ask("清空報表")
    const signal = adjust.mock.calls[0][2]!
    const onApply = vi.fn()
    assistant.connect({
      config: { ...config, name: "另一份" },
      available: true,
      onApply,
    })
    old.disconnect()
    expect(signal.aborted).toBe(true)
    resolve(proposal)
    expect(await pending).toContain("報表已變更")
    expect(assistant.getSnapshot()).toEqual({
      editing: true,
      busy: false,
      proposal: null,
    })
    assistant.apply()
    expect(onApply).not.toHaveBeenCalled()
  })
  it("AI 未設定或回傳釐清時不建立可套用的草稿", async () => {
    const assistant = createReportAssistant()
    const binding = assistant.connect({
      config,
      available: false,
      onApply: vi.fn(),
    })
    expect(await assistant.ask("新增圖表")).toContain("尚未設定")
    expect(adjust).not.toHaveBeenCalled()
    binding.update({ config, available: true, onApply: vi.fn() })
    adjust.mockResolvedValueOnce({
      kind: "clarify",
      message: "要看哪個指標？",
      config: null,
    })
    expect(await assistant.ask("新增圖表")).toBe("要看哪個指標？")
    expect(assistant.handles("銷售金額", page)).toBe(true)
    expect(assistant.getSnapshot()).toMatchObject({
      busy: false,
      proposal: null,
    })
  })
})
