import { describe, expect, it } from "vitest"
import type { OaField, OaTemplate } from "@/api/oa"
import { fillOaBlanks, oaMissing } from "@/lib/oa-legacy"

describe("OA 預填草稿", () => {
  it("只補空白，不覆蓋業務的修改", () => {
    expect(
      fillOaBlanks(
        { amount: "1500", reason: "  " },
        { amount: "4927", reason: "交通費", company: "裕民" }
      )
    ).toEqual({ amount: "1500", reason: "交通費", company: "裕民" })
  })
  it("缺件檢查包含客戶、共同欄位與空白說明", () => {
    const field: OaField = {
      key: "company",
      label: "公司",
      type: "text",
      required: true,
      sample: "裕民",
    }
    const template: OaTemplate = {
      code: "6039",
      display_code: "6039",
      title: "行銷資源",
      category: "業務",
      description: "",
      needs_customer: true,
      sap_origin: false,
      query_only: false,
      fields: [],
      sample_purpose: "",
    }
    expect(oaMissing(template, [field], { company: " " }, "", "")).toEqual([
      "客戶",
      "公司",
      "申請目的／說明",
    ])
    expect(
      oaMissing(template, [field], { company: "裕民" }, "活動用途", "C001")
    ).toEqual([])
  })
})
