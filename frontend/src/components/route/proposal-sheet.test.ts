import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { RouteProposal } from "@/api/route"
import { ProposalSheet } from "@/components/route/proposal-sheet"

function side(ids: string[], km = 30, minutes = 75) {
  return {
    stops: ids.map((id, n) => ({ customer_id: id, customer_name: `客戶${id}`, planned_time: `1${n}:00`, late_minutes: 0 })),
    travel_minutes: minutes,
    travel_km: km,
  }
}

function proposal(extra: Partial<RouteProposal> = {}): RouteProposal {
  return {
    id: 1, question: "先去德安再去佑生", kind: "proposal", summary: "加了一條『德安 排在 佑生 前面』，重新排了順序",
    changed: true, before: side(["A", "B", "C", "D"]), after: side(["A", "D", "B", "C"], 34, 90), rule_costs: [],
    late: [], habits_added: [], habits_disabled: [], dropped: [], notes: [], conflict: [], mention: null,
    candidates: [], text: null, estimated: true, ...extra,
  }
}

const noop = () => {}
const render = (p: RouteProposal, extra: { applying?: boolean; stale?: boolean; error?: string | null; placement?: "column" | "home" } = {}) =>
  renderToStaticMarkup(
    createElement(ProposalSheet, {
      proposal: p, applying: false, stale: false, error: null, onApply: noop, onClose: noop, onPick: noop,
      onRetry: noop, ...extra,
    })
  )

describe("ProposalSheet", () => {
  it("提案：一句話、現在與改成兩欄、換了位置的站加粗、各自的總里程與車程、套用與不用了", () => {
    const html = render(proposal({
      rule_costs: ["守住『德安 排在 佑生 前面』，比不守多繞 6 公里、15 分鐘"],
      late: ["客戶C 會晚到 25 分"],
      habits_added: ["星期一先跑板橋"],
      habits_disabled: ["康泰連鎖藥局的店排在診所前面"],
      dropped: ["今天不套用『診所排最後』，因為跟這個順序不合"],
      notes: ["找不到『長安』"],
    }))
    for (const text of [
      "加了一條『德安 排在 佑生 前面』，重新排了順序", "現在", "改成", "30 公里", "34 公里", "1 小時 30 分",
      "守住『德安 排在 佑生 前面』，比不守多繞 6 公里、15 分鐘", "客戶C 會晚到 25 分", "新增習慣：星期一先跑板橋",
      "停用習慣：康泰連鎖藥局的店排在診所前面", "今天不套用『診所排最後』，因為跟這個順序不合", "找不到『長安』", "套用", "不用了",
      "（估計）",
    ]) {
      expect(html).toContain(text)
    }
    expect(html.match(/data-moved="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-moved="true"[^>]*>.*客戶D/)
  })

  it("沒有要改的：沒有套用", () => {
    const html = render(proposal({ changed: false, summary: "現在的順序已經是最順的了", after: null }))
    expect(html).toContain("現在的順序已經是最順的了")
    expect(html).not.toContain("套用")
    expect(html).toContain("知道了")
  })

  it("排不出來：寫出擋住的規則，沒有套用", () => {
    const html = render(proposal({
      kind: "conflict", changed: false, after: null, conflict: ["德安 排在 板橋店 前面", "板橋店 鎖在第 1 站"],
    }))
    expect(html).toContain("這幾條規則互相衝突，拿掉其中一條才排得出來")
    expect(html).toContain("板橋店 鎖在第 1 站")
    expect(html).not.toContain("套用")
  })

  it("要選一個：問句與每家一顆鈕", () => {
    const html = render(proposal({
      kind: "ask_which", changed: false, before: null, after: null, mention: "康泰",
      candidates: [
        { customer_id: "C001", customer_name: "康泰 · 忠孝店" },
        { customer_id: "C081", customer_name: "康泰 · 大安店" },
      ],
    }))
    expect(html).toContain("你是說康泰 · 忠孝店，還是康泰 · 大安店？")
    expect(html.match(/data-candidate=/g)).toHaveLength(2)
  })

  it("只回答：一段話與知道了", () => {
    const html = render(proposal({ kind: "answer", changed: false, before: null, after: null, text: "因為帳款逾期最久。" }))
    expect(html).toContain("因為帳款逾期最久。")
    expect(html).toContain("知道了")
    expect(html).not.toContain("套用")
  })

  it("行程在問完之後改過了：用現在的行程重算", () => {
    const html = render(proposal(), { stale: true })
    expect(html).toContain("行程在你問完之後改過了")
    expect(html).toContain("用現在的行程重算")
    expect(html).not.toContain(">套用<")
  })

  it("Google 算的車程標 Google Maps", () => {
    expect(render(proposal({ estimated: false }))).toContain("Google Maps")
  })

  it("電腦版位置：首頁貼著左欄，沒給就對齊中間一欄", () => {
    expect(render(proposal(), { placement: "home" })).toContain("lg:left-[15.5rem]")
    const column = render(proposal())
    expect(column).toContain("lg:left-56")
    expect(column).not.toContain("lg:left-[15.5rem]")
  })
})
