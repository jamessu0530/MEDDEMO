import { describe, expect, it } from "vitest"
import { requestedChannelDemo } from "./channel-ui-demo"

describe("頻道原生輸入框的操作示範", () => {
  it.each(["@熊熊滾 操作給我看", "＠熊熊滾：教我用這個頁面", "@AI 幫我操作"])(
    "明確呼叫助理時就地示範：%s",
    (body) => {
      expect(requestedChannelDemo(body, "/channels/42?view=chat")).toEqual({
        kind: "page-tour",
        path: "/channels/42?view=chat",
      })
    }
  )
  it("可要求其他頁面的示範", () => {
    expect(requestedChannelDemo("@熊熊滾 教我用日曆", "/channels/42")).toEqual({
      kind: "page-tour",
      path: "/calendar",
    })
    expect(requestedChannelDemo("@熊熊滾 教我新增訂單", "/channels/42")).toEqual({
      kind: "create-order",
      path: undefined,
    })
  })
  it.each([
    "操作給我看",
    "請同事操作給我看",
    "@同事 操作給我看",
    "這是說明：@熊熊滾 操作給我看",
    "@熊熊滾 不用示範操作",
    "@熊熊滾 說明這個頁面怎麼用",
    "@熊熊滾 本月進貨多少？",
  ])("保留一般頻道訊息和查詢：%s", (body) => {
    expect(requestedChannelDemo(body, "/channels/42")).toBeNull()
  })
  it("有附檔時保留訊息與附件一起送出的流程", () => {
    expect(requestedChannelDemo("@熊熊滾 操作給我看", "/channels/42", true)).toBeNull()
  })
})
