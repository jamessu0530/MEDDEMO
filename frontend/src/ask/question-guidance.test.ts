import { describe, expect, it } from "vitest"

import { createConversation } from "@/ask/conversation"
import { pageContextFor } from "@/ask/page-context"
import {
  questionGuidance,
  shouldAcceptSuggestion,
  suggestedCompletion,
} from "@/ask/question-guidance"
import type { Ask, AskStatus } from "@/api/asks"

const page = pageContextFor("/customers/C01")
function conversation(
  status: AskStatus = "answered",
  question = "這家多久沒進貨了？"
) {
  const store = createConversation()
  store.addUtterance("user", "typed", question, { page })
  const id = store.addToolRun("data", question, { page })
  store.replace(id, {
    ask: { status, answer: "這家客戶最近一筆進貨在 9 月。" } as Ask,
  })
  return { store, id }
}

describe("隨頁面與回答變化的提問提示", () => {
  it("第一題依畫面提供提示，換頁後不套用先前的接續建議", () => {
    expect(questionGuidance(page, []).suggestions).toEqual(page.suggestions)
    const { store } = conversation()
    const next = pageContextFor("/calendar")
    expect(questionGuidance(next, store.getSnapshot())).toEqual({
      hint: next.hint,
      suggestions: next.suggestions,
    })
    expect(
      questionGuidance(pageContextFor("/customers/C02"), store.getSnapshot())
        .replyId
    ).toBeUndefined()
  })

  it("回答完成後根據主題給下一題，過濾已問過的建議", () => {
    const { store, id } = conversation()
    const guidance = questionGuidance(page, store.getSnapshot())
    expect(guidance.replyId).toBe(id)
    expect(guidance.suggestions).toContain("這家最近三個月的進貨有什麼變化？")
    expect(guidance.suggestions).not.toContain("這家多久沒進貨了？")
    const next = store.addToolRun("data", guidance.suggestions[0], { page })
    store.replace(next, {
      ask: { status: "answered", answer: "剛才的進貨資料如下。" } as Ask,
    })
    expect(
      questionGuidance(page, store.getSnapshot()).suggestions
    ).not.toContain(guidance.suggestions[0])
  })

  it("規定類回答提供限制與出處的追問", () => {
    const { store, id } = conversation("answered", "公司的退貨規定是什麼？")
    store.replace(id, { askKind: "knowledge" })
    expect(
      questionGuidance(page, store.getSnapshot()).suggestions[0]
    ).toContain("退貨規定")
  })

  it("OA 的即時操作回答也有下一步，不受前一頁對話影響", () => {
    const oa = pageContextFor("/oa/new/6071")
    const { store } = conversation()
    store.addUtterance("user", "typed", "這張表單還缺什麼資料？", { page: oa })
    const replyId = store.addUtterance(
      "model",
      "typed",
      "還缺申請目的，請補齊後再送簽。",
      { page: oa }
    )
    expect(questionGuidance(oa, store.getSnapshot())).toMatchObject({
      replyId,
      suggestions: ["這張表單怎麼預填？", "怎麼儲存草稿和送簽？"],
    })
    expect(questionGuidance(page, store.getSnapshot()).replyId).toBeUndefined()
  })

  it.each(["queued", "running", "failed"] as AskStatus[])(
    "%s 時不把未完成的結果當成回答",
    (status) => {
      const { store } = conversation(status)
      expect(questionGuidance(page, store.getSnapshot()).suggestions).toEqual(
        []
      )
    }
  )

  it("送出中、釐清、錯誤與取消時不提供誤導的補全", () => {
    const { store, id } = conversation()
    expect(
      questionGuidance(page, store.getSnapshot(), true).suggestions
    ).toEqual([])
    store.replace(id, { clarification: "請問你想查哪個期間？" })
    expect(questionGuidance(page, store.getSnapshot())).toMatchObject({
      suggestions: [],
      hint: expect.stringContaining("補充"),
    })
    store.replace(id, { clarification: null, error: "連線失敗" })
    expect(questionGuidance(page, store.getSnapshot()).replyId).toBeUndefined()
    store.replace(id, { error: null, cancelled: true })
    expect(questionGuidance(page, store.getSnapshot()).replyId).toBeUndefined()
  })

  it.each(["no_evidence", "not_converged"] as AskStatus[])(
    "%s 時提示補充線索，不假定有查到結果",
    (status) => {
      const { store } = conversation(status)
      expect(questionGuidance(page, store.getSnapshot()).suggestions[0]).toBe(
        "這個問題還需要補充哪些資料？"
      )
    }
  )
})

describe("Tab 帶入與鍵盤導覽", () => {
  const suggestions = ["這家上次拜訪談了什麼？", "這家多久沒進貨了？"]
  const key = {
    key: "Tab",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    nativeEvent: { isComposing: false },
  }

  it("空白與符合開頭的草稿可以補全，自訂問題與完整建議保留一般 Tab", () => {
    expect(suggestedCompletion("", suggestions)).toBe(suggestions[0])
    expect(suggestedCompletion("這家多久", suggestions)).toBe(suggestions[1])
    expect(suggestedCompletion("我有另一個問題", suggestions)).toBeNull()
    expect(suggestedCompletion(suggestions[0], suggestions)).toBeNull()
    expect(suggestedCompletion(" ", suggestions)).toBeNull()
    expect(suggestedCompletion("", [])).toBeNull()
    expect(shouldAcceptSuggestion(key, suggestions[0])).toBe(true)
    expect(shouldAcceptSuggestion(key, null)).toBe(false)
  })

  it.each(["shiftKey", "ctrlKey", "altKey", "metaKey"])(
    "%s 不攔截焦點與快捷鍵",
    (modifier) => {
      expect(
        shouldAcceptSuggestion({ ...key, [modifier]: true }, suggestions[0])
      ).toBe(false)
    }
  )

  it("中文組字與舊版瀏覽器的組字鍵碼都不觸發補全，Enter 也不帶入", () => {
    expect(
      shouldAcceptSuggestion(
        { ...key, nativeEvent: { isComposing: true } },
        suggestions[0]
      )
    ).toBe(false)
    expect(
      shouldAcceptSuggestion(
        { ...key, nativeEvent: { keyCode: 229 } },
        suggestions[0]
      )
    ).toBe(false)
    expect(
      shouldAcceptSuggestion({ ...key, key: "Enter" }, suggestions[0])
    ).toBe(false)
  })
})
