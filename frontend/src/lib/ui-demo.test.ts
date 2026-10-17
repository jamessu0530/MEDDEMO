import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OrderCustomer } from "@/api/orders"
import { makePracticeOrder } from "@/lib/order-practice"
import { PAYMENT_TERMS } from "@/lib/orders"
import {
  createUiDemo,
  canStartUiDemo,
  isUserTakeover,
  isUiDemoKind,
  matchesDemoPage,
  OA_APPS_DEMO_STEPS,
  OA_DEMO_STEPS,
  OA_DETAIL_DEMO_STEPS,
  OA_EDITOR_DEMO_STEPS,
  ORDER_DEMO_STEPS,
  REPORT_DEMO_STEPS,
  requestedUiDemo,
  wantsOrderDemo,
  wantsOaDemo,
  wantsReportDemo,
  type DemoStep,
} from "@/lib/ui-demo"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("訂單操作求助", () => {
  it.each([
    "我不會新增訂單，可以教我嗎？",
    "訂單怎麼建立？",
    "可以示範下單嗎？",
    "我不知道怎麼訂貨",
    "教我如何建立訂單",
  ])("提出邀請：%s", (question) => {
    expect(wantsOrderDemo(question)).toBe(true)
  })
  it.each([
    "北區有幾張訂單？",
    "最近三個月訂單為什麼減少？",
    "我不知道訂單金額是多少",
    "訂單優惠最多幾趴？",
    "不用示範訂單，告訴我規定",
    "教我怎麼調整路線",
  ])("保留既有查詢：%s", (question) => {
    expect(wantsOrderDemo(question)).toBe(false)
  })
})

describe("使用者接手", () => {
  it.each(["pointerdown", "touchstart", "wheel", "keydown", "click"])(
    "%s 立即中斷，程式產生的事件不中斷",
    (type) => {
      expect(isUserTakeover({ type, isTrusted: true })).toBe(true)
      expect(isUserTakeover({ type, isTrusted: false })).toBe(false)
    }
  )
  it("捲動到目標所產生的 scroll 不中斷", () => {
    expect(isUserTakeover({ type: "scroll", isTrusted: true })).toBe(false)
  })
})

function setup(
  steps?: readonly DemoStep[],
  initialPath = "/orders",
  missing: readonly string[] = []
) {
  let pathname = initialPath
  let interrupt = () => {}
  let connected = true
  let available = true
  const acted = vi.fn<
    (target: string, action: DemoStep["action"], value?: string) => void
  >((target) => {
    if (target === "orders-nav") pathname = "/orders"
    if (target === "practice-create") pathname = "/orders/demo"
    if (target === "oa-create-application") pathname = "/oa/apps"
    if (target === "oa-create-template") pathname = "/oa/new/expense"
  })
  const unlisten = vi.fn()
  const demo = createUiDemo(
    {
      pathname: () => pathname,
      listen: (stop) => {
        interrupt = stop
        return unlisten
      },
      target: (target) =>
        available && !missing.includes(target)
          ? {
              rect: () => ({ x: 10, y: 20, width: 50, height: 40 }),
              scroll: vi.fn(),
              connected: () => connected,
              act: (action, value) => acted(target, action, value),
            }
          : null,
    },
    steps
  )
  return {
    demo,
    acted,
    unlisten,
    interrupt: () => interrupt(),
    disconnect: () => {
      connected = false
    },
    unavailable: () => {
      available = false
    },
    go: (next: string) => {
      pathname = next
    },
  }
}

describe("示範執行與取消", () => {
  it("尚未同意不操作，同意後才逐步執行；最後只指向發送鈕", async () => {
    const { demo, acted, unlisten } = setup()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(acted).not.toHaveBeenCalled()
    demo.start()
    await vi.advanceTimersByTimeAsync(40_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.map(([target]) => target)).toEqual(
      ORDER_DEMO_STEPS.map((step) => step.target)
    )
    expect(acted).toHaveBeenLastCalledWith(
      "practice-submit",
      "point",
      undefined
    )
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it("客戶尚無付款條件時，先選練習單的條件再建立草稿", async () => {
    const customer: OrderCustomer = {
      id: "public-outlet",
      name: "公開通路（待核對）",
      owner_id: null,
      owner_name: null,
      payment_term: null,
      region: "北區",
    }
    let pathname = "/orders"
    let paymentTerm = ""
    const created = vi.fn()
    const demo = createUiDemo({
      pathname: () => pathname,
      listen: () => () => {},
      target: (id) => {
        if (id === "practice-create" && !paymentTerm) return null
        return {
          rect: () => ({ x: 10, y: 20, width: 100, height: 40 }),
          scroll: () => {},
          connected: () => true,
          act: (action, value) => {
            if (id === "practice-payment-term" && action === "fill")
              paymentTerm = value ?? ""
            if (id === "practice-create" && action === "click") {
              created(
                makePracticeOrder({ ...customer, payment_term: paymentTerm })
              )
              pathname = "/orders/demo"
            }
          },
        }
      },
    })

    demo.start("create-order")
    await vi.advanceTimersByTimeAsync(40_000)

    expect(demo.getSnapshot().status).toBe("completed")
    expect(created).toHaveBeenCalledOnce()
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "demo",
        customer_id: customer.id,
        payment_term: "RCD2",
      })
    )
    expect(PAYMENT_TERMS).toHaveProperty(paymentTerm)
    expect(customer.payment_term).toBeNull()
  })

  it("移動箭頭時接手，取消尚未發生的點擊與全部後續步驟", async () => {
    const { demo, acted, interrupt, unlisten } = setup()
    demo.start()
    await vi.advanceTimersByTimeAsync(700)
    expect(demo.getSnapshot().rect).not.toBeNull()
    interrupt()
    expect(demo.getSnapshot()).toMatchObject({
      status: "stopped",
      rect: null,
      clicking: false,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(acted).not.toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it("點擊前最後一刻中斷，這一下也不會執行", async () => {
    const { demo, acted, interrupt } = setup()
    demo.start()
    await vi.advanceTimersByTimeAsync(1700)
    expect(demo.getSnapshot().clicking).toBe(true)
    interrupt()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(acted).not.toHaveBeenCalled()
  })

  it("已完成一個動作後接手，不會繼續下一個", async () => {
    const { demo, acted, interrupt } = setup()
    demo.start()
    await vi.advanceTimersByTimeAsync(1900)
    expect(acted).toHaveBeenCalledTimes(1)
    interrupt()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(acted).toHaveBeenCalledTimes(1)
  })

  it("目標未載入就停止，不會猜位置往下點", async () => {
    const { demo, acted, unavailable } = setup()
    unavailable()
    demo.start()
    await vi.advanceTimersByTimeAsync(13_000)
    expect(demo.getSnapshot()).toMatchObject({ status: "failed", rect: null })
    expect(acted).not.toHaveBeenCalled()
  })

  it("等待動畫時目標被移除，或換了畫面，停止點擊", async () => {
    for (const change of ["disconnect", "navigate"] as const) {
      const { demo, acted, disconnect, go } = setup()
      demo.start()
      await vi.advanceTimersByTimeAsync(500)
      if (change === "disconnect") disconnect()
      else go("/channels")
      await vi.advanceTimersByTimeAsync(3000)
      expect(demo.getSnapshot().status).toBe("failed")
      expect(acted).not.toHaveBeenCalled()
    }
  })

  it("連按開始只跑一次；關閉會清掉計時器與接手監聽", async () => {
    const { demo, acted, unlisten } = setup()
    demo.start()
    demo.start()
    await vi.advanceTimersByTimeAsync(500)
    demo.dismiss()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(demo.getSnapshot().status).toBe("idle")
    expect(acted).not.toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("新版我的申請單操作求助", () => {
  it.each([
    "教我用我的申請單",
    "申請單怎麼填？",
    "OA表單怎麼建立？",
    "我的應用操作給我看",
    "我不會送出申請單",
    "幫我操作表單中心",
    "我的申請單怎麼搜尋？",
    "申請表如何補件？",
  ])("辨識明確的介面求助：%s", (question) => {
    expect(wantsOaDemo(question)).toBe(true)
    expect(requestedUiDemo(question)).toBe("oa-tour")
  })
  it.each([
    "我的申請單有幾張審核中？",
    "我的申請單為什麼被退回？",
    "OA申請的補助如何計算？",
    "不要幫我操作申請單",
    "不用示範我的申請單",
    "教我新增訂單",
  ])("保留查詢與拒絕：%s", (question) => {
    expect(wantsOaDemo(question)).toBe(false)
  })
  it("在 OA 頁面辨識這頁與預填操作，仍可詢問其他頁面的教學", () => {
    expect(
      requestedUiDemo("這頁怎麼用？", "/oa/forms?application=expense")
    ).toBe("oa-tour")
    expect(requestedUiDemo("教我預填", "/oa/new/expense")).toBe("oa-tour")
    expect(requestedUiDemo("這頁怎麼用？", "/customers")).toBe("page-tour")
    expect(requestedUiDemo("教我新增訂單", "/oa/forms")).toBe("create-order")
    expect(requestedUiDemo("教我用報表", "/oa/forms")).toBe("report-tour")
  })
  it("固定路由樣式只接受同層路徑，區分編輯與詳情", () => {
    expect(matchesDemoPage("/oa/forms/:formId", "/oa/forms/42/")).toBe(true)
    expect(matchesDemoPage("/oa/forms/:formId", "/oa/forms/42/edit")).toBe(
      false
    )
    expect(matchesDemoPage("/oa/forms/:formId/edit", "/oa/forms//edit")).toBe(
      false
    )
    expect(canStartUiDemo("oa-tour", "/oa/forms/42/edit")).toBe(true)
    expect(canStartUiDemo("oa-tour", "/manager")).toBe(false)
    expect(canStartUiDemo("create-order", "/orders/demo")).toBe(false)
    expect(isUiDemoKind("oa-tour")).toBe(true)
    expect(isUiDemoKind("constructor")).toBe(false)
    expect(isUiDemoKind({})).toBe(false)
  })
  it("從申請單清單導覽到新表單，所有資料操作都只指向位置", async () => {
    const { demo, acted } = setup(undefined, "/oa/forms")
    demo.start("oa-tour")
    expect(demo.getSnapshot().total).toBe(OA_DEMO_STEPS.length)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.map(([target]) => target)).toEqual(
      OA_DEMO_STEPS.map((step) => step.target)
    )
    expect(
      acted.mock.calls
        .filter(([, action]) => action !== "point")
        .map(([target, action]) => [target, action])
    ).toEqual([
      ["oa-open-filters", "click"],
      ["oa-create-application", "click"],
      ["oa-create-template", "click"],
    ])
    expect(acted).toHaveBeenLastCalledWith("oa-submit-area", "point", undefined)
  })
  it.each([
    ["/oa/apps", OA_APPS_DEMO_STEPS],
    ["/oa/new/expense", OA_EDITOR_DEMO_STEPS],
    ["/oa/forms/42/edit", OA_EDITOR_DEMO_STEPS],
    ["/oa/forms/42", OA_DETAIL_DEMO_STEPS],
  ] as const)("從 %s 就地開始，不重跑前一頁", async (path, expectedSteps) => {
    const { demo, acted } = setup(undefined, path)
    demo.start("oa-tour")
    expect(demo.getSnapshot().total).toBe(expectedSteps.length)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.map(([target]) => target)).toEqual(
      expectedSteps.map((step) => step.target)
    )
    if (path !== "/oa/apps")
      expect(acted.mock.calls.every(([, action]) => action === "point")).toBe(
        true
      )
  })
  it("空清單或桌機可略過手機開關與申請卡片", async () => {
    const { demo, acted } = setup(undefined, "/oa/forms", [
      "oa-open-filters",
      "oa-form-card",
    ])
    demo.start("oa-tour")
    await vi.advanceTimersByTimeAsync(90_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(
      acted.mock.calls.some(
        ([target]) => target === "oa-open-filters" || target === "oa-form-card"
      )
    ).toBe(false)
  })
  it("找不到可建立的表單就停止，不往下操作", async () => {
    const { demo, acted } = setup(undefined, "/oa/apps", ["oa-create-template"])
    demo.start("oa-tour")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(demo.getSnapshot().status).toBe("failed")
    expect(
      acted.mock.calls.some(([target]) => target === "oa-save-draft")
    ).toBe(false)
  })
  it("接手後取消後續導覽與表單操作", async () => {
    const { demo, acted, interrupt } = setup(undefined, "/oa/new/expense")
    demo.start("oa-tour")
    await vi.advanceTimersByTimeAsync(2000)
    interrupt()
    const count = acted.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(demo.getSnapshot().status).toBe("stopped")
    expect(acted).toHaveBeenCalledTimes(count)
  })
})

describe("新版報表操作求助", () => {
  it.each([
    "教我用新版報表",
    "報表怎麼匯出？",
    "報表篩選怎麼用？",
    "幫我操作報表",
    "報表操作給我看",
  ])("辨識操作求助：%s", (question) => {
    expect(wantsReportDemo(question)).toBe(true)
    expect(requestedUiDemo(question)).toBe("report-tour")
  })
  it.each([
    "報表的銷售有多少？",
    "報表為什麼業績減少？",
    "我不懂報表毛利率為什麼這麼低",
    "不用示範報表，告訴我數字",
    "不要幫我操作報表",
  ])("資料查詢與拒絕不觸發示範：%s", (question) => {
    expect(wantsReportDemo(question)).toBe(false)
  })
  it("只有報表情境能補足這頁的指代", () => {
    expect(requestedUiDemo("這頁怎麼篩選？", "/reports?view=overview")).toBe(
      "report-tour"
    )
    expect(requestedUiDemo("這頁怎麼篩選？", "/customers")).toBe("page-tour")
    expect(requestedUiDemo("教我新增訂單", "/reports")).toBe("create-order")
  })
  it("從報表開始並使用自己的進度與完成說明，最後不點擊下載", async () => {
    const { demo, acted } = setup(undefined, "/reports")
    demo.start("report-tour")
    expect(demo.getSnapshot()).toMatchObject({
      kind: "report-tour",
      total: REPORT_DEMO_STEPS.length,
      runId: 1,
    })
    await vi.advanceTimersByTimeAsync(70_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(demo.getSnapshot().text).toContain("匯出格式")
    expect(acted).toHaveBeenLastCalledWith(
      "report-export-download",
      "point",
      undefined
    )
    expect(acted.mock.calls.every(([, action]) => action !== "fill")).toBe(true)
  })
  it("唯讀或空白報表會略過不存在的圖表與編輯步驟", async () => {
    const missing = [
      "report-finish-editing",
      "report-start-editing",
      "report-page-tabs",
      "report-widget-resize",
      "report-visual-edit",
      "report-inspector",
      "report-inspector-close",
      "report-export-download",
    ]
    const { demo, acted } = setup(undefined, "/reports", missing)
    demo.start("report-tour")
    await vi.advanceTimersByTimeAsync(70_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.some(([target]) => missing.includes(target))).toBe(
      false
    )
    expect(acted).toHaveBeenLastCalledWith(
      "report-export-format",
      "point",
      undefined
    )
  })
  it("必要的新版控制項不見時停止，不猜點其他位置", async () => {
    const { demo, acted } = setup(undefined, "/reports", ["report-filters"])
    demo.start("report-tour")
    await vi.advanceTimersByTimeAsync(70_000)
    expect(demo.getSnapshot().status).toBe("failed")
    expect(
      acted.mock.calls.some(([target]) => target === "report-export")
    ).toBe(false)
  })
  it("使用者接手後不再開啟面板；重新開始使用新的執行編號", async () => {
    const { demo, acted, interrupt } = setup(undefined, "/reports")
    demo.start("report-tour")
    await vi.advanceTimersByTimeAsync(2000)
    interrupt()
    const calls = acted.mock.calls.length
    await vi.advanceTimersByTimeAsync(70_000)
    expect(acted).toHaveBeenCalledTimes(calls)
    expect(demo.getSnapshot().status).toBe("stopped")
    demo.start("report-tour")
    expect(demo.getSnapshot().runId).toBe(2)
    demo.dismiss()
  })
  it("不會從其他頁面直接執行報表示範", async () => {
    const { demo, acted } = setup()
    demo.start("report-tour")
    await vi.advanceTimersByTimeAsync(70_000)
    expect(demo.getSnapshot().status).toBe("idle")
    expect(acted).not.toHaveBeenCalled()
  })
})
