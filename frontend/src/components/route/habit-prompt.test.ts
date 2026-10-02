import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { HabitPrompt } from "@/components/route/habit-prompt"

describe("HabitPrompt", () => {
  it("問以後也這樣排嗎，三個選項，預設只有今天", () => {
    const html = renderToStaticMarkup(
      createElement(HabitPrompt, { text: "康泰忠孝店 排在 佑生藥局 前面", weekday: 2, onDone: () => {} })
    )
    expect(html).toContain("以後也這樣排嗎？")
    expect(html).toContain("康泰忠孝店 排在 佑生藥局 前面")
    expect(html).toMatch(/aria-checked="true"[^>]*>.*只有今天/)
    expect(html).toContain("每個星期三都這樣")
    expect(html).toContain("每次都這樣")
  })
})
