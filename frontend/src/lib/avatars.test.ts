import { describe, expect, it, vi } from "vitest"

import { AvatarStore, squareCrop } from "@/lib/avatars"

describe("squareCrop", () => {
  it("橫的照片裁掉左右，直的裁掉上下，都從中間", () => {
    expect(squareCrop(4000, 3000, 512)).toEqual({ sx: 500, sy: 0, edge: 3000, size: 512 })
    expect(squareCrop(1080, 1920, 512)).toEqual({ sx: 0, sy: 420, edge: 1080, size: 512 })
  })

  it("本來就比較小的不放大", () => {
    expect(squareCrop(300, 200, 512)).toEqual({ sx: 50, sy: 0, edge: 200, size: 200 })
  })
})

describe("AvatarStore", () => {
  it("整份取代，自己換或移除的馬上生效，每次都通知", () => {
    const store = new AvatarStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.replace({ U01: "/a/U01/1.jpg", U02: "/a/U02/1.jpg" })
    store.update("U01", "/a/U01/2.jpg")
    store.update("U02", null)
    expect(store.urlOf("U01")).toBe("/a/U01/2.jpg")
    expect(store.urlOf("U02")).toBeNull()
    expect(store.urlOf("M01")).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
