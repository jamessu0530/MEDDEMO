import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { MethodCardSource } from "@/api/methods"
import { MethodSourceDisplay } from "@/components/method-source-display"
import { MethodSourcePicker } from "@/components/method-source-picker"

const source: MethodCardSource = {
  message_id: 42,
  channel_id: 8,
  channel_name: "僅特定成員可见的頻道",
  author_name: "陳經理",
  body: "經理原始完整發言\n第二段，不是整理者寫的內容。",
  created_at: "2026-10-11T01:30:00Z",
  can_view: true,
}
const render = (value: MethodCardSource | null | undefined, showLink = true) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MethodSourceDisplay, { source: value, showLink })
    )
  )

describe("MethodSourceDisplay", () => {
  it("可見來源有独立經理署名、日期、原文與可重載跳轉連結", () => {
    const html = render(source)
    expect(html).toContain("來源發言：陳經理")
    expect(html).toContain("10/11 09:30")
    expect(html).toContain(source.body)
    expect(html).toContain(source.channel_name)
    expect(html).toContain('href="/channels/8?message=42"')
    expect(html).toContain("查看經理原文")
  })

  it("沒有權限時不洩露原文、頻道名稱或跳轉連結，即使 payload 仍帶這些欄位", () => {
    const html = render({ ...source, can_view: false })
    expect(html).toContain("來源發言：陳經理")
    expect(html).toContain("來源頻道依權限開放")
    expect(html).not.toContain(source.body)
    expect(html).not.toContain(source.channel_name)
    expect(html).not.toContain("/channels/")
    expect(html).not.toContain("查看經理原文")
  })

  it("編輯表單可直接閱讀來源，避免跳转使未上架的草稿離開表單", () => {
    const html = render(source, false)
    expect(html).toContain(source.body)
    expect(html).toContain("查看經理原文")
    expect(html).not.toContain("前往原訊息")
    expect(html).not.toContain("/channels/")
  })

  it("原訊息刪除或 ID 無效時不拼出失效或敏感連結", () => {
    for (const partial of [
      { message_id: null },
      { channel_id: null },
      { message_id: 0 },
      { channel_id: -1 },
    ]) {
      const html = render({ ...source, ...partial })
      expect(html).toContain("原訊息目前無法查看")
      expect(html).not.toContain(source.body)
      expect(html).not.toContain(source.channel_name)
      expect(html).not.toContain("/channels/")
    }
  })

  it("原文或頻道名稱缺失仍可顯示已知署名，不假設所有欄位完整", () => {
    const html = render({
      ...source,
      body: null,
      channel_name: null,
      created_at: "invalid",
    })
    expect(html).toContain("來源發言：陳經理")
    expect(html).not.toContain("查看經理原文")
    expect(html).not.toContain("Invalid Date")
  })

  it("舊卡與沒有引用來源的卡不新增空區塊", () => {
    expect(render(undefined)).toBe("")
    expect(render(null)).toBe("")
  })
})

describe("MethodSourcePicker", () => {
  it("同一畫面的原生搜尋與返回按鈕可用鍵盤，初始載入狀態可被朗讀", () => {
    const html = renderToStaticMarkup(
      createElement(MethodSourcePicker, {
        onSelect: () => {},
        onCancel: () => {},
      })
    )
    expect(html).toContain('type="search"')
    expect(html).toContain('for="method-source-search"')
    expect(html).toContain('role="status"')
    expect(html).toContain("搜尋所有可見頻道")
    expect(html).toContain("返回方法卡")
    expect(html).not.toContain('role="dialog"')
  })
})
