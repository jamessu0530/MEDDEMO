import { describe, expect, it } from "vitest"

import { inOrder } from "@/lib/in-order"

describe("inOrder", () => {
  it("先點 A 再點 B、A 的回應比較晚到：A 的不套用，打勾與進度不退回去", () => {
    const arrivals = inOrder()
    const a = arrivals.next()
    const b = arrivals.next()
    expect(arrivals.take(b)).toBe(true)
    expect(arrivals.take(a)).toBe(false)
  })

  it("照順序回來就每個都套用", () => {
    const arrivals = inOrder()
    const a = arrivals.next()
    const b = arrivals.next()
    expect(arrivals.take(a)).toBe(true)
    expect(arrivals.take(b)).toBe(true)
  })

  it("同一個號碼不會套用兩次", () => {
    const arrivals = inOrder()
    const a = arrivals.next()
    expect(arrivals.take(a)).toBe(true)
    expect(arrivals.take(a)).toBe(false)
  })
})
