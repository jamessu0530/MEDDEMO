import { describe, expect, it } from "vitest"
import type { OaField, OaTemplate } from "@/api/oa"
import { oaEditorContext, oaPageHelp } from "@/ask/oa-page-help"
import { mergePageContext, pageContextFor } from "@/ask/page-context"

const common: OaField[] = [
  {
    key: "company",
    label: "公司",
    type: "text",
    required: true,
    sample: "裕民",
  },
]
const template: OaTemplate = {
  code: "6071",
  display_code: "6071",
  title: "供應商建立請求",
  category: "採購",
  description: "",
  needs_customer: false,
  sap_origin: false,
  query_only: false,
  sample_purpose: "",
  fields: [
    {
      key: "phone",
      label: "聯絡電話",
      type: "text",
      required: true,
      sample: "",
    },
    {
      key: "bank_reference",
      label: "銀行資料",
      type: "text",
      required: true,
      sample: "",
    },
  ],
}
const editor = (fields: Record<string, string> = {}) =>
  mergePageContext(pageContextFor("/oa/new/6071"), [
    oaEditorContext(template, common, fields, "用途說明", ""),
  ])

describe("OA 共用助理的目前畫面", () => {
  it("缺件回答隨目前欄位更新，不會把已填欄位列為缺件", () => {
    expect(
      oaPageHelp("這張表單還缺什麼資料？", editor({ company: "裕民" }))
    ).toContain("還缺：聯絡電話、銀行資料")
    expect(
      oaPageHelp(
        "這張表單還缺什麼資料？",
        editor({ company: "裕民", phone: "123", bank_reference: "已核對" })
      )
    ).toContain("必填資料已填齊")
  })
  it("不把銀行、電話或申請內容的值送進共用問答情境", () => {
    const context = oaEditorContext(
      template,
      common,
      {
        company: "私人公司名稱",
        phone: "私人聯絡電話",
        bank_reference: "私人銀行帳號",
      },
      "私人申請內容",
      ""
    )
    const data = JSON.stringify(context)
    for (const text of [
      "私人公司名稱",
      "私人聯絡電話",
      "私人銀行帳號",
      "私人申請內容",
    ])
      expect(data).not.toContain(text)
    expect(data).toContain("聯絡電話")
  })
  it("未開表單、資料未載入時不宣稱已填齊", () => {
    expect(
      oaPageHelp("這張表單還缺什麼資料？", pageContextFor("/oa/apps"))
    ).toContain("先開啟")
  })
  it("操作求助只在 OA 依介面回答；其他公司問題維持 AI 查詢", () => {
    const current = editor()
    expect(oaPageHelp("這張表單怎麼預填？", current)).toContain(
      "保留你已修改的內容"
    )
    expect(oaPageHelp("怎麼儲存草稿和送簽？", current)).toContain("手機底部")
    expect(oaPageHelp("公司的供應商付款規定是什麼？", current)).toBeNull()
    expect(oaPageHelp("康泰的銀行帳號是什麼？", current)).toBeNull()
    expect(
      oaPageHelp("這張表單還缺什麼資料？", pageContextFor("/customers/C001"))
    ).toBeNull()
  })
  it("只能補件的申請人收到編輯提示，審閱者收到請申請人補件", () => {
    const page = pageContextFor("/oa/forms/123")
    page.facts.push("申請狀態：已退回", "可編輯草稿：不可以")
    expect(oaPageHelp("這張申請現在是什麼狀態？", page)).toContain(
      "請申請人補件"
    )
    page.facts = ["申請狀態：已退回", "可編輯草稿：可以"]
    expect(oaPageHelp("這張申請現在是什麼狀態？", page)).toContain(
      "補件後重新送出"
    )
  })
})
