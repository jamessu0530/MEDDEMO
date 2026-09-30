import { describe, expect, it } from "vitest"

import { applyCountdown, festivalCountdown, formatFullDate, formatRate, missedText } from "@/lib/negotiation"

describe("formatRate", () => {
  it("毛利率留一位小數，供貨價與通路獎勵這種整數成數不留", () => {
    expect(formatRate(0.6759, 1)).toBe("67.6%")
    expect(formatRate(0.5524, 1)).toBe("55.2%")
    expect(formatRate(0.95)).toBe("95%")
    expect(formatRate(0.02)).toBe("2%")
    expect(formatRate(1)).toBe("100%")
  })
})

describe("formatFullDate", () => {
  it("節慶與申請期限常跨年，日期帶年份", () => {
    expect(formatFullDate("2027-02-06")).toBe("2027/2/6")
    expect(formatFullDate("2026-12-19")).toBe("2026/12/19")
  })
})

describe("festivalCountdown", () => {
  it("節日當天還算這一個節慶", () => {
    expect(festivalCountdown(14)).toBe("還有 14 天")
    expect(festivalCountdown(0)).toBe("就是今天")
  })
})

describe("applyCountdown", () => {
  it("申請期限當天還來得及", () => {
    expect(applyCountdown(52)).toBe("還有 52 天")
    expect(applyCountdown(0)).toBe("今天是最後一天")
  })
})

describe("missedText", () => {
  it("名稱結尾是數字時跟中文之間空一格，多個節慶用頓號接", () => {
    expect(missedText(["雙 11"])).toBe("雙 11 的檔期來不及申請了")
    expect(missedText(["過年"])).toBe("過年的檔期來不及申請了")
    expect(missedText(["雙 11", "過年"])).toBe("雙 11、過年的檔期來不及申請了")
  })
})
