import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"
import type { CustomerInquiry } from "@/api/customer-inquiries"
import { CustomerInquiryCard } from "@/components/manager/customer-inquiries-panel"

const inquiry: CustomerInquiry = {
  id: "ask-1",
  rep: { id: "U01", name: "林昱辰", region: "北區" },
  customers: [{ id: "C01", name: "康泰忠孝店" }],
  question: "這家客戶的折扣可以怎麼談？",
  kind: "knowledge",
  status: "no_evidence",
  created_at: "2026-10-18T08:30:00Z",
}

function render(item = inquiry) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CustomerInquiryCard, {
        inquiry: item,
        backTo: "/manager?rep=U01",
      })
    )
  )
}

describe("客戶提問卡片", () => {
  it("顯示客戶、業務、問題與 AI 狀態，客戶可以打開檔案", () => {
    const html = render()
    for (const value of [
      "康泰忠孝店",
      "林昱辰",
      inquiry.question,
      "AI 查無依據",
      "10/18 16:30",
      'href="/customers/C01"',
    ])
      expect(html).toContain(value)
    expect(html).not.toContain("位置")
    expect(html).not.toContain("拜訪進度")
  })
  it("已回答不代表客戶問題已解決；多間客戶各自保留入口", () => {
    const html = render({
      ...inquiry,
      status: "answered",
      customers: [...inquiry.customers, { id: "C02", name: "第二間藥局" }],
    })
    expect(html).toContain("AI 已回答")
    expect(html).not.toContain("已解決")
    expect(html).toContain('href="/customers/C02"')
  })
})
