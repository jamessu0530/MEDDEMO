import { describe, expect, it, vi } from "vitest"
import type { Ask, QuestionSuggestionsInput } from "@/api/asks"
import { createConversation } from "@/ask/conversation"
import { recentConversationTurns } from "@/ask/conversation-context"
import { mergePageContext, pageContextFor } from "@/ask/page-context"
import {
  createSuggestionLoader,
  questionSuggestionInput,
} from "@/ask/suggestion-request"

const page = mergePageContext(pageContextFor("/customers/C01"), [
  { title: "康泰 · 客戶檔案", facts: ["客戶：康泰", "期間：最近三個月"] },
])
const ask = (answer: string, status: Ask["status"] = "answered") =>
  ({ status, answer }) as Ask

describe("建議帶入完整頁面與多輪對話", () => {
  it("傳送目前選取對象與條件，保留先前頁面的問答來源", () => {
    const conversation = createConversation()
    conversation.addUtterance("user", "typed", "只比較保健品", { page })
    const one = conversation.addToolRun("data", "只比較保健品", { page })
    conversation.replace(one, { ask: ask("康泰的保健品進貨減少。") })
    conversation.addUtterance("user", "typed", "期間改成最近一個月", { page })
    const two = conversation.addToolRun("data", "期間改成最近一個月", { page })
    conversation.replace(two, { ask: ask("最近一個月的變化如下。") })
    const report = mergePageContext(pageContextFor("/reports"), [
      {
        facts: [
          "選取圖表：每月銷售",
          "商品分類：保健品",
          "日期範圍：2026-09-01 至 2026-09-30",
        ],
      },
    ])
    const input = questionSuggestionInput(
      report,
      conversation.getSnapshot(),
      report.suggestions
    )!
    expect(input.page.facts).toContain("選取圖表：每月銷售")
    expect(input.page.facts).toContain("日期範圍：2026-09-01 至 2026-09-30")
    expect(input.earlier.map((turn) => turn.question)).toEqual([
      "只比較保健品",
      "期間改成最近一個月",
    ])
    expect(input.earlier.every((turn) => turn.page?.path === page.path)).toBe(
      true
    )
    const next = questionSuggestionInput(
      { ...report, facts: ["選取圖表：客戶銷售排行"] },
      conversation.getSnapshot(),
      report.suggestions
    )
    expect(JSON.stringify(next)).not.toBe(JSON.stringify(input))
  })

  it("OA 即時回答與一般查詢都包含在紀錄中，工具與語音覆述不重複", () => {
    const conversation = createConversation()
    const oa = pageContextFor("/oa/new/6071")
    conversation.addUtterance("user", "typed", "這張表單還缺什麼資料？", {
      page: oa,
    })
    conversation.addUtterance("model", "typed", "還缺申請目的。", { page: oa })
    conversation.addUtterance("user", "voice", "那這家客戶呢？", { page })
    conversation.addUtterance("model", "voice", "我幫你查一下。", { page })
    const tool = conversation.addToolRun("data", "康泰最近進貨如何？", { page })
    conversation.replace(tool, { ask: ask("這家最近一個月進貨減少。") })
    conversation.addUtterance("model", "voice", "康泰最近一個月進貨減少。", {
      page,
    })
    const turns = recentConversationTurns(conversation.getSnapshot())
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      question: "這張表單還缺什麼資料？",
      answer: "還缺申請目的。",
      page: { path: oa.path },
    })
    expect(turns[1]).toMatchObject({
      question: "康泰最近進貨如何？",
      answer: "這家最近一個月進貨減少。",
      page: { path: page.path },
    })
  })

  it("只保留最近六輪，限制答案大小並略過失敗或尚未完成的查詢", () => {
    const conversation = createConversation()
    for (let n = 0; n < 8; n++) {
      conversation.addUtterance("user", "typed", `第${n}題`, { page })
      const tool = conversation.addToolRun("data", `第${n}題`, { page })
      conversation.replace(tool, { ask: ask("答".repeat(2000)) })
    }
    const failed = conversation.addToolRun("data", "出錯的問題", { page })
    conversation.replace(failed, {
      ask: ask("不該使用", "failed"),
      error: "連線失敗",
    })
    conversation.addToolRun("data", "還在查詢", { page, routing: true })
    const turns = recentConversationTurns(conversation.getSnapshot())
    expect(turns.map((turn) => turn.question)).toEqual([
      "第2題",
      "第3題",
      "第4題",
      "第5題",
      "第6題",
      "第7題",
    ])
    expect(turns.every((turn) => turn.answer.length === 1000)).toBe(true)
    expect(
      questionSuggestionInput(
        page,
        conversation.getSnapshot(),
        page.suggestions
      )
    ).toBeNull()
  })

  it("語音為打字回覆保留的空白位置不會吃掉原本的問題", () => {
    const conversation = createConversation()
    conversation.addUtterance("user", "typed", "只比較最近一個月", { page })
    conversation.addUtterance("user", "voice", "", { page })
    conversation.addUtterance("model", "voice", "最近一個月的資料如下。", {
      page,
    })
    expect(recentConversationTurns(conversation.getSnapshot())).toMatchObject([
      { question: "只比較最近一個月", answer: "最近一個月的資料如下。" },
    ])
  })

  it("釐清問題及其原題、附檔線索保留，操作示範邀請不冒充已完成的回答", () => {
    const conversation = createConversation()
    conversation.addUtterance("user", "typed", "這個能退嗎？", { page })
    const tool = conversation.addToolRun(null, "這個能退嗎？", {
      page,
      hasFile: true,
    })
    conversation.replace(tool, { clarification: "請問是哪個品項？" })
    expect(recentConversationTurns(conversation.getSnapshot())).toMatchObject([
      { question: "這個能退嗎？", answer: "請問是哪個品項？", has_file: true },
    ])
    expect(
      questionSuggestionInput(
        page,
        conversation.getSnapshot(),
        page.suggestions
      )
    ).not.toBeNull()
    conversation.addUtterance("user", "typed", "教我操作", { page })
    conversation.addUtterance("model", "typed", "操作給你看？", {
      page,
      demo: "page-tour",
    })
    expect(recentConversationTurns(conversation.getSnapshot())).toHaveLength(1)
  })
})

describe("非同步建議不會混入其他畫面", () => {
  const input: QuestionSuggestionsInput = {
    page,
    earlier: [{ question: "這家多久沒進貨了？", answer: "一個月", page }],
    candidates: page.suggestions,
  }

  it("每個畫面與對話內容各自快取，換選取條件就重新取得", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ suggestions: ["康泰上次拜訪談了什麼？"] })
    const loader = createSuggestionLoader(fetch)
    const signal = new AbortController().signal
    await loader.load(input, signal)
    await loader.load(input, signal)
    expect(fetch).toHaveBeenCalledTimes(1)
    await loader.load(
      {
        ...input,
        page: { ...page, facts: [...page.facts, "商品分類：保健品"] },
      },
      signal
    )
    await loader.load(
      {
        ...input,
        earlier: [
          ...input.earlier,
          { question: "只看北區", answer: "已按北區整理。" },
        ],
      },
      signal
    )
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("切頁中止後的遲到回覆不顯示、不進快取", async () => {
    let resolve!: (value: { suggestions: string[] }) => void
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue({ suggestions: ["新的建議？"] })
    const loader = createSuggestionLoader(fetch)
    const controller = new AbortController()
    const pending = loader.load(input, controller.signal)
    controller.abort()
    resolve({ suggestions: ["舊畫面的建議？"] })
    expect(await pending).toEqual([])
    expect(await loader.load(input, new AbortController().signal)).toEqual([
      "新的建議？",
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("換帳號後清除先前快取，同樣的頁面也重新產生", async () => {
    const fetch = vi.fn().mockResolvedValue({ suggestions: ["新的建議？"] })
    const loader = createSuggestionLoader(fetch)
    const signal = new AbortController().signal
    await loader.load(input, signal, "U01")
    await loader.load(input, signal, "U01")
    await loader.load(input, signal, "U02")
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("移除重複、已問過、空白與過長的結果；網路失敗可保留頁面範例", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        suggestions: [
          "這家多久沒進貨了",
          "新問題？",
          "新問題",
          " ",
          "長".repeat(121),
        ],
      })
      .mockRejectedValue(new Error("offline"))
    const loader = createSuggestionLoader(fetch)
    const signal = new AbortController().signal
    expect(await loader.load(input, signal)).toEqual(["新問題？"])
    expect(
      await loader.load({ ...input, candidates: ["另一個頁面範例"] }, signal)
    ).toEqual([])
  })
})
