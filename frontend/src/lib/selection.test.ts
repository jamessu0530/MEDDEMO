import { describe, expect, it } from "vitest"
import {
  searchOptions,
  toggleSelection,
  toggleSelectionPage,
} from "./selection"

describe("搜尋選擇器", () => {
  it("名稱、地址和料號都可用多個關鍵字搜尋，支援全半形與台臺", () => {
    const options = [
      { value: "ABC123", label: "臺北示範藥局", description: "中正路 10 號" },
      { value: "C2", label: "高雄藥局" },
    ]
    expect(searchOptions(options, "台北 ＡＢＣ")).toEqual([options[0]])
    expect(searchOptions(options, "中正路 10")).toEqual([options[0]])
    expect(searchOptions(options, "台北 高雄")).toEqual([])
  })
  it("本頁全選與取消只變更本頁，保留其他搜尋結果的選取", () => {
    const chosen = toggleSelectionPage(["previous"], ["A", "B"])
    expect(chosen).toEqual(["previous", "A", "B"])
    expect(toggleSelectionPage(chosen, ["A", "B"])).toEqual(["previous"])
    expect(toggleSelectionPage(["previous", "A"], ["A", "B"])).toEqual(chosen)
  })
  it("全選不超過上限，達上限後仍可取消個別選項", () => {
    expect(toggleSelectionPage(["X"], ["A", "B", "C"], 3)).toEqual([
      "X",
      "A",
      "B",
    ])
    expect(toggleSelection(["X", "A"], "B", 2)).toEqual(["X", "A"])
    expect(toggleSelection(["X", "A"], "A", 2)).toEqual(["X"])
    expect(toggleSelectionPage(["X", "X"], [])).toEqual(["X"])
  })
})
