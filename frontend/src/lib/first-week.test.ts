import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { countDone, readDone, setDone } from "@/lib/first-week"

// vite.config.ts 的測試環境是 node，沒有 localStorage：補一個最小的假物件，測完用 vi.unstubAllGlobals 拆掉
function fakeStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("readDone／setDone", () => {
  it("打勾就記下來，取消就拿掉，重複打勾不會多記一次", () => {
    expect(readDone("U01")).toEqual([])
    let done = setDone("U01", [], "d1-customers", true)
    done = setDone("U01", done, "d1-doc-visit", true)
    expect(done).toEqual(["d1-customers", "d1-doc-visit"])
    done = setDone("U01", done, "d1-doc-visit", true)
    expect(done).toEqual(["d1-customers", "d1-doc-visit"])
    expect(readDone("U01")).toEqual(["d1-customers", "d1-doc-visit"])
    done = setDone("U01", done, "d1-customers", false)
    expect(done).toEqual(["d1-doc-visit"])
    expect(readDone("U01")).toEqual(["d1-doc-visit"])
  })

  it("同一支手機換人登入，看不到上一個人的勾選", () => {
    setDone("U01", [], "d1-customers", true)
    expect(readDone("U02")).toEqual([])
  })

  it("手機的儲存空間讀不到或內容壞了，當作還沒勾過", () => {
    localStorage.setItem("meddemo:first-week:U01", "不是 JSON")
    expect(readDone("U01")).toEqual([])
    localStorage.setItem("meddemo:first-week:U01", JSON.stringify({ done: "d1-customers" }))
    expect(readDone("U01")).toEqual([])
    localStorage.setItem("meddemo:first-week:U01", JSON.stringify(["d1-customers", 7, null]))
    expect(readDone("U01")).toEqual(["d1-customers"])
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError")
      },
    })
    expect(readDone("U01")).toEqual([])
  })

  it("存不進去（空間滿了、無痕模式）不出錯，連勾兩件，兩件都還在畫面上", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    })
    // 照畫面目前的勾選算，不回頭讀手機裡那份：手機裡什麼都沒存進去，重讀的話勾第二件會把第一件弄不見
    const first = setDone("U01", [], "d1-customers", true)
    expect(first).toEqual(["d1-customers"])
    const second = setDone("U01", first, "d1-doc-visit", true)
    expect(second).toEqual(["d1-customers", "d1-doc-visit"])
    expect(setDone("U01", second, "d1-customers", false)).toEqual(["d1-doc-visit"])
  })
})

describe("countDone", () => {
  const taskIds = ["d1-customers", "d1-doc-visit", "d2-promotions"]

  it("算現在這幾件事裡勾了幾件", () => {
    expect(countDone(taskIds, [])).toBe(0)
    expect(countDone(taskIds, ["d2-promotions", "d1-customers"])).toBe(2)
  })

  it("設定檔換了 id 等於新的一件事，舊的勾選不算", () => {
    expect(countDone(taskIds, ["d1-customers", "d1-old-task"])).toBe(1)
    expect(countDone([], ["d1-customers"])).toBe(0)
  })
})
