import { describe, expect, it, vi } from "vitest"

import { avatarTone, initials, ownStatus, PresenceStore } from "@/lib/presence"

describe("initials", () => {
  it("中文取最後兩個字，兩個字以內整個名字", () => {
    expect(initials("林昱辰")).toBe("昱辰")
    expect(initials("歐陽娜娜")).toBe("娜娜")
    expect(initials("評審")).toBe("評審")
  })

  it("英文取前兩個字母；兩個字以上取前兩個字的字首", () => {
    expect(initials("James")).toBe("JA")
    expect(initials("james su")).toBe("JS")
    expect(initials("  Amy  ")).toBe("AM")
  })

  it("中英夾雜只看中文；空白名字給問號", () => {
    expect(initials("Amy 林")).toBe("林")
    expect(initials("   ")).toBe("?")
  })
})

describe("avatarTone", () => {
  it("同一個帳號永遠同一個顏色，而且在範圍內", () => {
    expect(avatarTone("U01", 5)).toBe(avatarTone("U01", 5))
    for (const id of ["U01", "U02", "M01", "A01", "s-3f9a"]) {
      const tone = avatarTone(id, 5)
      expect(tone).toBeGreaterThanOrEqual(0)
      expect(tone).toBeLessThan(5)
    }
  })
})

describe("PresenceStore", () => {
  it("完整的一份取代原本的，離線的人不存", () => {
    const store = new PresenceStore()
    store.apply(true, { U01: "available", U02: "busy" })
    store.apply(true, { M01: "away" })
    expect(store.statusOf("U01")).toBe("offline")
    expect(store.statusOf("M01")).toBe("away")
    expect([...store.getSnapshot().keys()]).toEqual(["M01"])
  })

  it("部分更新只動有變的人，變成離線就拿掉", () => {
    const store = new PresenceStore()
    store.apply(true, { U01: "available", U02: "busy" })
    store.apply(false, { U02: "offline", M01: "dnd" })
    expect(Object.fromEntries(store.getSnapshot())).toEqual({ U01: "available", M01: "dnd" })
  })

  it("收過完整的一份才用即時的狀態，清空後回到用 API 回的", () => {
    const store = new PresenceStore()
    expect(store.statusOr("U02", "busy")).toBe("busy")
    store.apply(false, { U01: "available" })
    expect(store.isLoaded()).toBe(false)
    store.apply(true, { U01: "available" })
    expect(store.statusOr("U02", "busy")).toBe("offline")
    store.clear()
    expect(store.statusOr("U02", "busy")).toBe("busy")
  })

  it("每次更新都換一個新的 Map 並通知聽眾", () => {
    const store = new PresenceStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()
    store.apply(false, { U01: "available" })
    expect(store.getSnapshot()).not.toBe(before)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("ownStatus", () => {
  it("選了就照選的顯示，連「顯示為離線」也是；沒選就是別人看到的", () => {
    expect(ownStatus("offline", "available")).toBe("offline")
    expect(ownStatus("busy", "away")).toBe("busy")
    expect(ownStatus(null, "away")).toBe("away")
  })
})
