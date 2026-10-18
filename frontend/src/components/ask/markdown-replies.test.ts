import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"
import type { Ask } from "@/api/asks"
import type { Utterance } from "@/ask/conversation"
import { AskAnswer } from "@/components/ask/ask-result"
import { EntryView } from "@/components/ask/entry-view"
import { MarkdownContent } from "@/components/markdown-content"

function answer(text: string): Ask {
  return {
    id: "markdown",
    kind: "data",
    question: "有哪些商品？",
    status: "answered",
    answer: text,
    evidence: null,
    error_message: null,
    trace: [],
    customers: [],
    attachment: null,
  }
}

const renderAnswer = (text: string) =>
  renderToStaticMarkup(
    createElement(AskAnswer, { ask: answer(text), compact: true })
  )
const renderEntry = (kind: Utterance["kind"], text: string) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(EntryView, {
        entry: { id: 1, kind, source: "typed", text },
        busy: false,
        onAskAsTyped: () => undefined,
      })
    )
  )

describe("助理回覆的 Markdown 排版", () => {
  it("將型錄答案的標題、粗體、清單與分隔線轉成排版", () => {
    const html = renderAnswer(
      "### 商品型錄\n\n共 **89 項**商品：\n\n1. 一般品項\n2. 其他品項\n\n- 商品 A\n- 商品 B\n\n---\n\n料號 `C490115`"
    )
    for (const expected of [
      "<h3>商品型錄</h3>",
      "<strong>89 項</strong>",
      "<ol>",
      "<ul>",
      "<li>商品 A</li>",
      "<hr/>",
      "<code>C490115</code>",
    ])
      expect(html).toContain(expected)
    expect(html).not.toContain("### 商品型錄")
    expect(html).not.toContain("**89 項**")
  })

  it("顯示 GFM 表格內容並保留可捲動的表格容器", () => {
    const html = renderAnswer(
      "| 類別 | 數量 |\n| :--- | ---: |\n| 一般品項 | 37 |\n| 其他品項 | 52 |"
    )
    for (const expected of [
      'aria-label="回覆表格"',
      'tabindex="0"',
      "<table>",
      "<thead>",
      "<tbody>",
      ">一般品項</td>",
      ">37</td>",
    ])
      expect(html).toContain(expected)
  })

  it("直接回覆與重新載入的回覆都套用排版，使用者原話保持原樣", () => {
    const text = "## 查詢結果\n\n**商品 A**"
    expect(renderEntry("model", text)).toContain("<strong>商品 A</strong>")
    expect(renderEntry("user", text)).toContain("**商品 A**")
    expect(renderEntry("user", text)).not.toContain("<strong>")
    expect(renderAnswer(text)).toContain("<h2>查詢結果</h2>")
  })

  it("保留普通文字與跳脫符號，不把模型回覆中的 HTML 或腳本連結當程式執行", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        children:
          '第一行\n第二行\n\n\\*保留星號\\*\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[危險連結](javascript:alert%281%29)\n\n[依據](https://example.com/source)',
      })
    )
    expect(html).toContain("第一行\n第二行")
    expect(html).toContain("*保留星號*")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('href="https://example.com/source"')
    expect(html).toContain('rel="noreferrer noopener"')
  })
})
