import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"
import { createConversation } from "@/ask/conversation"
import { createTaskSession } from "@/ask/task-session"
import { AssistantTasks } from "@/components/ask/assistant-tasks"

describe("助理工作清單", () => {
  it("顯示超過三項工作的進度、返回入口與缺資料訊息", () => {
    const session = createTaskSession("test", new AbortController().signal, false)
    const ids = session.queue.apply({ handled: true, message: "", commands: Array.from({ length: 8 }, (_, n) => ({
      action: "create" as const, key: `item-${n}`, target_id: "", capability: "report.create", title: `報表 ${n + 1}`, instruction: `報表 ${n + 1}`, after: [],
    })) })
    session.queue.complete(ids[0], { path: "/reports", id: "one" }, "報表已儲存")
    session.queue.wait(ids[1], "請指定期間")
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(AssistantTasks, { session, conversation: createConversation() })))
    expect(markup).toContain("7 項待處理")
    expect(markup).toContain("返回工作")
    expect(markup).toContain("請指定期間")
    expect(markup).toContain("報表 8")
  })

  it("逐店顯示歷史來源、草稿入口、價差、跳過與重試", () => {
    const session = createTaskSession("test", new AbortController().signal, false)
    const [id] = session.queue.apply({ handled: true, message: "", commands: [{
      action: "create", key: "route", target_id: "", capability: "order.route_repeat", title: "路線開單", instruction: "照上次", after: [],
    }] })
    session.queue.progress(id, { state: "paused", revision: 3, rep_id: "S1", rep_name: "王業務", route_id: 1, route_version: 2, route_date: "2031-04-17",
      stores: [
        { customer_id: "C1", customer_name: "康泰", source_order_no: "OLD-1", source_date: "2031-04-01", status: "completed", message: "草稿已儲存", warnings: ["單價：100 → 120"], resource: { id: "saved", path: "/orders/saved" } },
        { customer_id: "C2", customer_name: "仁愛", source_order_no: null, source_date: null, status: "needs_attention", message: "沒有歷史訂單", warnings: [], resource: null },
      ] }, "已保存")
    session.queue.pause(id)
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(AssistantTasks, { session, conversation: createConversation() })))
    for (const text of ["康泰", "仁愛", "OLD-1", "沒有歷史訂單", "單價：100 → 120", "跳過", "重試", "檢查草稿", "2031-04-17"])
      expect(markup).toContain(text)
    expect(markup).toContain('href="/orders/saved"')
    expect(markup).toContain('max="2" value="1"')
  })
})
