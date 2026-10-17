import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createUiDemo, isUserTakeover, ORDER_DEMO_STEPS, wantsOrderDemo, type DemoStep } from "@/lib/ui-demo"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("訂單操作求助", () => {
  it.each(["我不會新增訂單，可以教我嗎？", "訂單怎麼建立？", "可以示範下單嗎？", "我不知道怎麼訂貨", "教我如何建立訂單"])("提出邀請：%s", (question) => {
    expect(wantsOrderDemo(question)).toBe(true)
  })
  it.each(["北區有幾張訂單？", "最近三個月訂單為什麼減少？", "我不知道訂單金額是多少", "訂單優惠最多幾趴？", "不用示範訂單，告訴我規定", "教我怎麼調整路線"])("保留既有查詢：%s", (question) => {
    expect(wantsOrderDemo(question)).toBe(false)
  })
})

describe("使用者接手", () => {
  it.each(["pointerdown", "touchstart", "wheel", "keydown", "click"])("%s 立即中斷，程式產生的事件不中斷", (type) => {
    expect(isUserTakeover({ type, isTrusted: true })).toBe(true)
    expect(isUserTakeover({ type, isTrusted: false })).toBe(false)
  })
  it("捲動到目標所產生的 scroll 不中斷", () => {
    expect(isUserTakeover({ type: "scroll", isTrusted: true })).toBe(false)
  })
})

function setup(steps?: readonly DemoStep[]) {
  let pathname = "/orders"
  let interrupt = () => {}
  let connected = true
  let available = true
  const acted = vi.fn<(target: string, action: DemoStep["action"], value?: string) => void>((target) => {
    if (target === "orders-nav") pathname = "/orders"
    if (target === "practice-create") pathname = "/orders/demo"
  })
  const unlisten = vi.fn()
  const demo = createUiDemo({
    pathname: () => pathname,
    listen: (stop) => { interrupt = stop; return unlisten },
    target: (target) => available ? ({
      rect: () => ({ x: 10, y: 20, width: 50, height: 40 }),
      scroll: vi.fn(), connected: () => connected,
      act: (action, value) => acted(target, action, value),
    }) : null,
  }, steps)
  return {
    demo, acted, unlisten, interrupt: () => interrupt(),
    disconnect: () => { connected = false },
    unavailable: () => { available = false },
    go: (next: string) => { pathname = next },
  }
}

describe("示範執行與取消", () => {
  it("尚未同意不操作，同意後才逐步執行；最後只指向發送鈕", async () => {
    const { demo, acted, unlisten } = setup()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(acted).not.toHaveBeenCalled()
    demo.start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(demo.getSnapshot().status).toBe("completed")
    expect(acted.mock.calls.map(([target]) => target)).toEqual(ORDER_DEMO_STEPS.map((step) => step.target))
    expect(acted).toHaveBeenLastCalledWith("practice-submit", "point", undefined)
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it("移動箭頭時接手，取消尚未發生的點擊與全部後續步驟", async () => {
    const { demo, acted, interrupt, unlisten } = setup()
    demo.start()
    await vi.advanceTimersByTimeAsync(700)
    expect(demo.getSnapshot().rect).not.toBeNull()
    interrupt()
    expect(demo.getSnapshot()).toMatchObject({ status: "stopped", rect: null, clicking: false })
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
