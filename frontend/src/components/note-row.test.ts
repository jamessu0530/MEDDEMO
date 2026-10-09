import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { NoteRow } from "@/components/note-row"

describe("NoteRow", () => {
  it("競品備忘標「競品」", () => {
    const html = renderToStaticMarkup(
      createElement(NoteRow, {
        note: { kind: "competitor", text: "提到御松田", on_date: "2026-10-19", customer_name: "忠孝店" },
      })
    )
    expect(html).toContain('aria-label="競品"')
    expect(html).toContain("提到御松田")
  })
})
