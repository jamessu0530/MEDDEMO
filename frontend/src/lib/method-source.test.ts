import { describe, expect, it } from "vitest"

import type { MethodCardSource, MethodSourceMessage } from "@/api/methods"
import {
  METHOD_APPROACH_MAX,
  mergeMethodSources,
  methodSourceAccess,
  methodSourceForDisplay,
  methodSourcePatch,
  quoteMethodSource,
} from "@/lib/method-source"

const message: MethodSourceMessage = {
  message_id: 42,
  channel_id: 8,
  channel_name: "團隊討論",
  author_name: "陳經理",
  body: "先確認付款日，再排拜訪。",
  created_at: "2026-10-11T01:30:00Z",
}
const original: MethodCardSource = { ...message, can_view: true }

describe("方法卡來源草稿", () => {
  it("修改原卡不碰來源時 PATCH 省略欄位，保留後端來源", () => {
    expect(methodSourcePatch({ kind: "unchanged" })).toEqual({})
    expect(methodSourceForDisplay({ kind: "unchanged" }, original)).toBe(
      original
    )
    expect(methodSourceForDisplay({ kind: "unchanged" })).toBeNull()
  })

  it("換來源送出實際訊息 ID，移除才傳 null", () => {
    expect(methodSourcePatch({ kind: "chosen", message })).toEqual({
      source_message_id: 42,
    })
    expect(methodSourcePatch({ kind: "removed" })).toEqual({
      source_message_id: null,
    })
    expect(
      methodSourceForDisplay({ kind: "chosen", message }, original)
    ).toEqual({ ...message, can_view: true })
    expect(methodSourceForDisplay({ kind: "removed" }, original)).toBeNull()
  })

  it("空草稿帶入原文，已有整理內容保持原樣", () => {
    expect(quoteMethodSource("", message.body)).toEqual({
      approach: message.body,
      inserted: true,
      needsCondensing: false,
    })
    expect(quoteMethodSource("   ", message.body).approach).toBe(message.body)
    const edited = "我整理過的第一步。\n第二步帶對帳明細。"
    expect(quoteMethodSource(edited, message.body)).toEqual({
      approach: edited,
      inserted: false,
      needsCondensing: false,
    })
  })

  it("2000 字邊界可上架，超長原文完整保留並標記需要整理", () => {
    const full = "經理原文".repeat(600)
    expect(
      quoteMethodSource("", "字".repeat(METHOD_APPROACH_MAX)).needsCondensing
    ).toBe(false)
    const quotation = quoteMethodSource("", full)
    expect(quotation.approach).toBe(full)
    expect(quotation.approach.length).toBeGreaterThan(METHOD_APPROACH_MAX)
    expect(quotation.needsCondensing).toBe(true)
  })

  it("即使新來源超长，仍不覆蓋原本的整理內容", () => {
    const current = "我整理的做法"
    expect(quoteMethodSource(current, "字".repeat(3000))).toEqual({
      approach: current,
      inserted: false,
      needsCondensing: false,
    })
  })
})

describe("來源存取與游標合併", () => {
  it("需要 can_view 和兩個有效 ID 才能顯示敏感來源內容", () => {
    expect(methodSourceAccess(original)).toBe("viewable")
    expect(methodSourceAccess({ ...original, can_view: false })).toBe(
      "restricted"
    )
    for (const id of [null, 0, -1, 1.5, Infinity, NaN]) {
      expect(methodSourceAccess({ ...original, message_id: id })).toBe(
        "missing"
      )
      expect(methodSourceAccess({ ...original, channel_id: id })).toBe(
        "missing"
      )
    }
  })

  it("載入更多重試不重複訊息，刷新同一訊息且保留既有順序", () => {
    const newest = { ...message, message_id: 44 }
    const updated = { ...message, body: "原文已補充" }
    const older = { ...message, message_id: 40 }
    const before = [newest, message]
    const merged = mergeMethodSources(before, [updated, older])
    expect(merged.map((item) => item.message_id)).toEqual([44, 42, 40])
    expect(merged[1].body).toBe("原文已補充")
    expect(before).toEqual([newest, message])
  })
})
