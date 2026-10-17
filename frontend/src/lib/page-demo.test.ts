import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildPageDemoSteps,
  canTourPage,
  pageDemoCanClick,
  requestedPageDemoPath,
  wantsPageDemo,
  type PageDemoControl,
} from "@/lib/page-demo"
import {
  createUiDemo,
  requestedUiDemo,
  uiDemoKindForPage,
  type DemoStep,
} from "@/lib/ui-demo"

const control = (
  label: string,
  kind: PageDemoControl["kind"] = "action",
  opens?: PageDemoControl["opens"]
): PageDemoControl => ({ target: label, label, kind, opens })

describe("目前畫面的操作教學", () => {
  it("保留欄位與選項，只代點明確標記的展開入口", () => {
    const steps = buildPageDemoSteps("/calendar", [
      control("日曆", "heading"),
      control("搜尋行程", "search"),
      control("事件名稱", "field"),
      control("檢視方式", "choice"),
      control("儲存"),
      control("客戶", "navigation"),
      control("新增事件", "action", "dialog"),
    ])
    expect(steps.filter((step) => step.action !== "point")).toMatchObject([
      { target: "新增事件", action: "click" },
    ])
    expect(steps.at(-1)).toMatchObject({
      target: "page-tour-dialog",
      action: "point",
    })
    expect(steps.some((step) => step.action === "fill")).toBe(false)
    expect(steps.find((step) => step.target === "儲存")?.text).toContain(
      "自行確認"
    )
  })
  it.each([
    "儲存",
    "送出",
    "發送至 SAP",
    "刪除帳號",
    "解除綁定",
    "核准",
    "退回",
    "重設密碼",
    "開始錄音",
    "上傳",
    "下載",
    "登入",
    "註冊",
    "登出",
    "套用設定",
  ])("即使被誤標也不會代點 %s", (label) => {
    expect(pageDemoCanClick(control(label, "action", "dialog"))).toBe(false)
    expect(
      buildPageDemoSteps("/settings", [
        control(label, "action", "dialog"),
      ]).every((step) => step.action === "point")
    ).toBe(true)
  })
  it("停用控制項只解釋位置；未標記的新增鈕也不代點", () => {
    const disabled = {
      ...control("新增事件", "action", "dialog"),
      disabled: true,
    }
    expect(pageDemoCanClick(disabled)).toBe(false)
    expect(pageDemoCanClick(control("新增事件"))).toBe(false)
    expect(buildPageDemoSteps("/calendar", [disabled])[0].text).toContain(
      "目前無法使用"
    )
  })
  it("多張重複卡片只介紹一次，保留搜尋、欄位、選項與入口的差異", () => {
    const steps = buildPageDemoSteps("/products", [
      control("商品", "heading"),
      ...Array.from({ length: 30 }, () => control("查看規格")),
      control("搜尋商品", "search"),
      control("分類", "choice"),
    ])
    expect(steps.filter((step) => step.target === "查看規格")).toHaveLength(1)
    expect(steps.map((step) => step.target)).toContain("搜尋商品")
    expect(steps.length).toBeLessThanOrEqual(7)
  })
  it("安全展開資料內容後不收合或修改其他內容", () => {
    const steps = buildPageDemoSteps("/first-week", [
      control("參考資料", "action", "disclosure"),
    ])
    expect(steps).toMatchObject([
      { action: "click", target: "參考資料" },
      { action: "point", target: "參考資料-content" },
    ])
  })
})

describe("全站操作求助與目的頁面", () => {
  it.each([
    "操作給我看",
    "幫我操作這個頁面",
    "幫我點擊",
    "教我用日曆",
    "這個畫面怎麼操作？",
    "帶我操作頻道",
  ])("辨識 %s", (question) => {
    expect(wantsPageDemo(question)).toBe(true)
    expect(requestedUiDemo(question, "/calendar")).toBe("page-tour")
  })
  it.each([
    "今天有幾個行程？",
    "這家為什麼沒進貨？",
    "日曆同步有什麼規定？",
    "不要幫我操作",
    "不用示範操作",
    "我不想操作給我看",
  ])("查詢與拒絕繼續走既有流程：%s", (question) => {
    expect(wantsPageDemo(question)).toBe(false)
  })
  it("指定頁面會前往正確入口；目前的詳細頁與查詢條件會保留", () => {
    expect(requestedPageDemoPath("教我用日曆", "/customers/C01")).toBe(
      "/calendar"
    )
    expect(requestedPageDemoPath("教我用頻道", "/channels/42?view=files")).toBe(
      "/channels/42?view=files"
    )
    expect(requestedPageDemoPath("操作給我看", "/orders/42")).toBe("/orders/42")
    expect(requestedPageDemoPath("教我用商品學習", "/customers")).toBe(
      "/learning/products"
    )
    expect(
      requestedPageDemoPath("操作給我看", "/auth/google/callback?code=secret")
    ).toBeNull()
    expect(canTourPage("/login")).toBe(true)
    expect(canTourPage("//example.com")).toBe(false)
    expect(canTourPage("/\\example.com")).toBe(false)
    expect(canTourPage("/auth?code=test")).toBe(false)
    expect(wantsPageDemo("教我用毛利率計算獲利")).toBe(false)
    expect(requestedUiDemo("操作給我看", "/reports")).toBe("report-tour")
    expect(requestedUiDemo("操作給我看", "/oa/forms/42/edit")).toBe("oa-tour")
  })
  it("報表、申請單和訂單保留自己的完整示範；商品分頁不誤開新訂單", () => {
    expect(uiDemoKindForPage("/reports")).toBe("report-tour")
    expect(uiDemoKindForPage("/oa/forms/42/edit")).toBe("oa-tour")
    expect(uiDemoKindForPage("/orders")).toBe("create-order")
    expect(uiDemoKindForPage("/orders", "?view=products")).toBe("page-tour")
    expect(uiDemoKindForPage("/orders/42")).toBe("page-tour")
  })
})

describe("共用教學執行與切頁保護", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  function setup(
    initial: readonly DemoStep[] = buildPageDemoSteps("/calendar", [
      control("日曆", "heading"),
      control("新增", "action", "dialog"),
    ])
  ) {
    let location = "/calendar?view=month"
    let plan = initial
    let interrupt = () => {}
    const acted = vi.fn()
    const unlisten = vi.fn()
    const demo = createUiDemo({
      pathname: () => location.split("?")[0],
      location: () => location,
      pageSteps: () => plan,
      target: () => ({
        rect: () => ({ x: 0, y: 20, width: 100, height: 40 }),
        scroll: vi.fn(),
        connected: () => true,
        act: acted,
      }),
      listen: (stop) => {
        interrupt = stop
        return unlisten
      },
    })
    return {
      demo,
      acted,
      unlisten,
      interrupt: () => interrupt(),
      go: (path: string) => {
        location = path
      },
      ready: (steps: readonly DemoStep[]) => {
        plan = steps
      },
    }
  }
  it("從目前頁面執行，使用實際步數並只代點展開入口", async () => {
    const { demo, acted } = setup()
    demo.start("page-tour")
    await vi.advanceTimersByTimeAsync(100)
    expect(demo.getSnapshot()).toMatchObject({
      kind: "page-tour",
      pageKey: "/calendar?view=month",
      total: 3,
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.map(([action]) => action)).toEqual([
      "point",
      "click",
      "point",
    ])
  })
  it("即使只有查詢參數改變，也不繼續操作舊畫面", async () => {
    const { demo, acted, go } = setup()
    demo.start("page-tour")
    await vi.advanceTimersByTimeAsync(700)
    go("/calendar?view=week")
    await vi.advanceTimersByTimeAsync(20_000)
    expect(demo.getSnapshot().status).toBe("failed")
    expect(acted).not.toHaveBeenCalled()
  })
  it("先等待畫面載入，再依實際控制項產生步驟", async () => {
    const { demo, ready, acted } = setup([])
    demo.start("page-tour")
    await vi.advanceTimersByTimeAsync(500)
    expect(acted).not.toHaveBeenCalled()
    ready(buildPageDemoSteps("/calendar", [control("日曆", "heading")]))
    await vi.advanceTimersByTimeAsync(5000)
    expect(demo.getSnapshot()).toMatchObject({ status: "completed", total: 1 })
  })
  it("接手或離開載入畫面就中止，不延後開啟任何面板", async () => {
    const { demo, interrupt, acted, unlisten } = setup()
    demo.start("page-tour")
    await vi.advanceTimersByTimeAsync(500)
    interrupt()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(demo.getSnapshot().status).toBe("stopped")
    expect(acted).not.toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalledOnce()
  })
})
