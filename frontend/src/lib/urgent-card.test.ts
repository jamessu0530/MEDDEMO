import { describe, expect, it } from "vitest"

import type { RouteUrgent } from "@/api/route"
import { urgentCard } from "@/lib/urgent-card"

function urgent(id: string): RouteUrgent {
  return { customer_id: id, customer_name: `客戶${id}`, signal: "ar", headline: "帳款逾期", detail: "拖了 78 天", note: null }
}

describe("urgentCard", () => {
  it("行程上有急件就照它，可以按", () => {
    expect(urgentCard(urgent("a"), null, false)).toEqual({ urgent: urgent("a"), stale: false, closing: false })
    // 剛點過的那一張還留著、又來一張新的：照新的
    expect(urgentCard(urgent("b"), urgent("a"), true)).toEqual({ urgent: urgent("b"), stale: false, closing: false })
  })

  it("沒有急件、也沒有剛點掉的：不顯示", () => {
    expect(urgentCard(null, null, false)).toBeNull()
    expect(urgentCard(null, null, true)).toBeNull()
  })

  it("點了急件那一站、熊還在騎：留著剛點掉的那一張，鈕不能按", () => {
    expect(urgentCard(null, urgent("a"), true)).toEqual({ urgent: urgent("a"), stale: true, closing: false })
  })

  it("熊到了（或根本沒騎）：收起來", () => {
    expect(urgentCard(null, urgent("a"), false)).toEqual({ urgent: urgent("a"), stale: true, closing: true })
  })
})
