import { describe, expect, it } from "vitest"
import { createConversation } from "@/ask/conversation"
import { taskToolResult } from "@/voice/task-result"

describe("語音交辦回覆", () => {
  it("真的缺資料時照實追問，不固定回覆已安排工作", () => {
    const conversation = createConversation()
    conversation.addUtterance("user", "voice", "幫我開那家店")
    conversation.addUtterance("model", "voice", "剛剛有康泰一店與康泰二店，要替哪一家開單？")
    const result = taskToolResult(conversation.getSnapshot())
    expect(result.output.answer).toBe("剛剛有康泰一店與康泰二店，要替哪一家開單？")
    expect(result.output.answer).not.toContain("已安排")
  })

  it("回傳草稿單號及待確認事項，保留草稿與正式送出的區別", () => {
    const conversation = createConversation()
    conversation.addUtterance("model", "voice", "已儲存康泰的訂單草稿 OD123，請新增商品並確認後送出。")
    const result = taskToolResult(conversation.getSnapshot())
    expect(result.output.answer).toContain("草稿 OD123")
    expect(result.output.instruction).toContain("不可說已正式送出")
  })

  it("尚無結果時只回覆處理中", () => {
    expect(taskToolResult([]).output.answer).toBe("工作正在處理，執行結果或待補資料會顯示在工作清單。")
  })
})
