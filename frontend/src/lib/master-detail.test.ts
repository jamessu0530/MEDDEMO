import { describe, expect, it } from "vitest"

import { itemParam, nextAfter, pickItem } from "@/lib/master-detail"

const items = [{ id: 4 }, { id: 7 }, { id: 9 }]

describe("pickItem", () => {
  it("網址上記的那一張還在清單裡就選它", () => {
    expect(pickItem(items, 7)).toEqual({ id: 7 })
  })
  it("沒記、或那一張已經不在清單裡，選第一張", () => {
    expect(pickItem(items, null)).toEqual({ id: 4 })
    expect(pickItem(items, 99)).toEqual({ id: 4 })
  })
  it("清單是空的就沒有", () => {
    expect(pickItem([], 4)).toBeNull()
  })
})

describe("nextAfter", () => {
  it("拿掉一張之後選它後面那張", () => {
    expect(nextAfter(items, 4)).toBe(7)
    expect(nextAfter(items, 7)).toBe(9)
  })
  it("拿掉的是最後一張就選前面那張", () => {
    expect(nextAfter(items, 9)).toBe(7)
  })
  it("只剩它、或它不在清單裡，就沒有", () => {
    expect(nextAfter([{ id: 4 }], 4)).toBeNull()
    expect(nextAfter(items, 99)).toBeNull()
  })
})

describe("itemParam", () => {
  it("正整數才算", () => {
    expect(itemParam("12")).toBe(12)
    expect(itemParam(null)).toBeNull()
    expect(itemParam("")).toBeNull()
    expect(itemParam("0")).toBeNull()
    expect(itemParam("-3")).toBeNull()
    expect(itemParam("1.5")).toBeNull()
    expect(itemParam("abc")).toBeNull()
  })
})
