import { describe, expect, it } from "vitest"

import type { Approval } from "@/api/customers"
import {
  approvalFlash,
  contractRoute,
  discountSteps,
  formatProbability,
  formatRate,
  oaDateText,
  parseDiscount,
} from "@/lib/approval"

const approval = (patch: Partial<Approval>): Approval => ({
  form_id: 1,
  form_no: "DC20261000104",
  status: "pending",
  auto_approved: false,
  probability: null,
  waiting_for: { step: "區處主管", name: "陳建宏" },
  ...patch,
})

describe("discountSteps", () => {
  it("3% 以內是業務自己的權限，不用簽", () => {
    expect(discountSteps(0)).toEqual({ valid: true, steps: [], text: "在你的權限內，直接送出" })
    expect(discountSteps(3).steps).toEqual([])
  })

  it("超過 3% 到 8% 要區處主管，模型有把握會由系統核准", () => {
    expect(discountSteps(3.5)).toEqual({ valid: true, steps: ["區處主管"], text: "要區處主管核准，系統有把握會直接核准" })
    expect(discountSteps(8).steps).toEqual(["區處主管"])
  })

  it("超過 8% 逐級往上送處長、總經理", () => {
    expect(discountSteps(8.5)).toEqual({ valid: true, steps: ["區處主管", "業務處長"], text: "要區處主管與業務處長核准" })
    expect(discountSteps(12).steps).toEqual(["區處主管", "業務處長"])
    expect(discountSteps(12.5)).toEqual({
      valid: true,
      steps: ["區處主管", "業務處長", "總經理"],
      text: "要區處主管、業務處長與總經理核准",
    })
    expect(discountSteps(20).steps).toHaveLength(3)
  })

  it("超過 20%、負的、不是 0.5 的倍數都不收", () => {
    expect(discountSteps(20.5)).toEqual({ valid: false, steps: [], text: "折扣要在 0～20% 之間" })
    expect(discountSteps(-1).valid).toBe(false)
    expect(discountSteps(4.2)).toEqual({ valid: false, steps: [], text: "折扣每 0.5% 一格" })
    expect(discountSteps(Number.NaN).valid).toBe(false)
  })
})

describe("parseDiscount", () => {
  it("沒填就是不打折，亂打的字是 NaN", () => {
    expect(parseDiscount("")).toBe(0)
    expect(parseDiscount("  ")).toBe(0)
    expect(parseDiscount("5.5")).toBe(5.5)
    expect(parseDiscount("abc")).toBeNaN()
  })
})

describe("contractRoute", () => {
  it("照原費率由區處主管核准，費率一改就要送業務處長", () => {
    expect(contractRoute(0.08, 0.08, 0.05, 0.05)).toEqual({ changed: false, text: "照原費率續約，要區處主管核准，系統有把握會直接核准" })
    expect(contractRoute(0.08, 0.085, 0.05, 0.05)).toEqual({ changed: true, text: "費率有調整，要送業務處長" })
    expect(contractRoute(0.08, 0.08, 0.05, 0.045).changed).toBe(true)
  })
})

describe("formatProbability / formatRate", () => {
  it("機率最多寫到 99%，不把估計寫成保證", () => {
    expect(formatProbability(0.62)).toBe("62%")
    expect(formatProbability(0.998)).toBe("99%")
  })

  it("費率到 0.1 個百分點，整數不帶小數", () => {
    expect(formatRate(0.08)).toBe("8%")
    expect(formatRate(0.085)).toBe("8.5%")
    expect(formatRate(0.07)).toBe("7%")
  })
})

describe("oaDateText", () => {
  it("出差單是拜訪日，優惠與合約是送單那天", () => {
    expect(oaDateText({ trip_date: "2026-10-24", request_date: null })).toBe("10/24 拜訪")
    expect(oaDateText({ trip_date: null, request_date: "2026-10-27" })).toBe("10/27 申請")
  })
})

describe("approvalFlash", () => {
  it("系統核准的寫出過去類似的申請有幾成會過", () => {
    const done = approval({ status: "approved", auto_approved: true, probability: 0.94, waiting_for: null })
    expect(approvalFlash("報價 Q20261028-0001 已開，折扣 5%", done)).toBe(
      "報價 Q20261028-0001 已開，折扣 5% 系統已核准（過去類似的申請 94% 會過）"
    )
  })

  it("送人簽的寫出等誰簽", () => {
    expect(approvalFlash("報價 Q20261028-0002 已開，折扣 7%", approval({}))).toBe("報價 Q20261028-0002 已開，折扣 7% 已送陳建宏簽核")
    expect(approvalFlash("續約申請 CT20261000037", approval({ form_no: "CT20261000037" }))).toBe("續約申請 CT20261000037 已送陳建宏簽核")
  })
})
