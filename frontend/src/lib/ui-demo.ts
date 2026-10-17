export type DemoRect = { x: number; y: number; width: number; height: number }
export type DemoStep = {
  target: string
  page: string
  text: string
  action: "click" | "fill" | "point"
  value?: string
}

/** 固定的教學步驟；問答只提出教學邀請，不能傳入程式碼、選擇器或任意點擊位置。 */
export const ORDER_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "new-order",
    page: "/orders",
    action: "click",
    text: "按「新增訂單」，開始選擇客戶。",
  },
  {
    target: "practice-customer",
    page: "/orders",
    action: "fill",
    value: "DEMO-CUSTOMER",
    text: "先選客戶。這次用教學藥局練習。",
  },
  {
    target: "practice-create",
    page: "/orders",
    action: "click",
    text: "按「建立草稿」，進入訂單內容。",
  },
  {
    target: "practice-add-products",
    page: "/orders/demo",
    action: "click",
    text: "接著按「新增產品」，挑選要訂的商品。",
  },
  {
    target: "practice-product",
    page: "/orders/demo",
    action: "click",
    text: "勾選商品。加入後可以調整數量與單價。",
  },
  {
    target: "practice-confirm-products",
    page: "/orders/demo",
    action: "click",
    text: "按這裡，將勾選的商品加入訂單。",
  },
  {
    target: "practice-shipping_address",
    page: "/orders/demo",
    action: "fill",
    value: "教學用收貨地址",
    text: "填寫收貨地址。這裡先放教學資料。",
  },
  {
    target: "practice-recipient",
    page: "/orders/demo",
    action: "fill",
    value: "示範收貨人",
    text: "再填收貨人，並確認出貨日期與付款條件。",
  },
  {
    target: "practice-save",
    page: "/orders/demo",
    action: "click",
    text: "按「儲存草稿」，保留目前填好的內容。",
  },
  {
    target: "practice-submit",
    page: "/orders/demo",
    action: "point",
    text: "正式訂單要先確認金額與收貨資料，再由你按「發送至 SAP」。",
  },
]

/** 只辨識明確的介面求助；業績、訂單數字與公司規定仍走既有查詢。 */
export function wantsOrderDemo(question: string) {
  const text = question.replace(/\s/g, "")
  if (!/(訂單|下單|訂貨)/.test(text)) return false
  if (/(不要|不用|不需|不想|別).{0,6}(示範|操作|教我|帶我)/.test(text))
    return false
  return /(不會|不懂|不知道怎麼|怎麼(新增|建立|開|下|訂|操作)|如何(新增|建立|開|下|訂|操作)|教我|帶我|示範|操作給我看)/.test(
    text
  )
}

export type DemoState = {
  status: "idle" | "running" | "stopped" | "completed" | "failed"
  step: number
  text: string
  rect: DemoRect | null
  clicking: boolean
}
export type DemoTarget = {
  rect: () => DemoRect
  scroll: () => void
  connected: () => boolean
  act: (action: DemoStep["action"], value?: string) => void
}
export type DemoEnvironment = {
  pathname: () => string
  target: (id: string) => DemoTarget | null
  listen: (interrupt: () => void) => () => void
}

export const isUserTakeover = (event: Pick<Event, "type" | "isTrusted">) =>
  event.isTrusted &&
  ["pointerdown", "touchstart", "wheel", "keydown", "click"].includes(
    event.type
  )

const INITIAL: DemoState = {
  status: "idle",
  step: 0,
  text: "",
  rect: null,
  clicking: false,
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("stopped"))
      return
    }
    const abort = () => {
      clearTimeout(timer)
      reject(new Error("stopped"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}

export function createUiDemo(
  env: DemoEnvironment,
  steps: readonly DemoStep[] = ORDER_DEMO_STEPS
) {
  let state = INITIAL
  let controller: AbortController | null = null
  let unlisten: (() => void) | null = null
  const listeners = new Set<() => void>()
  function publish(patch: Partial<DemoState>) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  function cleanup() {
    controller?.abort()
    controller = null
    unlisten?.()
    unlisten = null
  }
  function stop(text = "已停止示範，現在由你操作。") {
    if (state.status !== "running") return
    cleanup()
    publish({ status: "stopped", text, rect: null, clicking: false })
  }
  async function run(signal: AbortSignal) {
    try {
      for (const [index, step] of steps.entries()) {
        publish({ step: index + 1, text: step.text, clicking: false })
        let target: DemoTarget | null = null
        for (let attempt = 0; attempt < 120; attempt++) {
          if (signal.aborted) return
          if (env.pathname() === step.page) target = env.target(step.target)
          if (target) break
          await delay(100, signal)
        }
        if (!target) throw new Error("target unavailable")
        target.scroll()
        await delay(200, signal)
        publish({ rect: target.rect() })
        await delay(1400, signal)
        if (signal.aborted) return
        if (env.pathname() !== step.page || !target.connected())
          throw new Error("page changed")
        publish({ rect: target.rect(), clicking: step.action !== "point" })
        await delay(220, signal)
        if (signal.aborted) return
        if (env.pathname() !== step.page || !target.connected())
          throw new Error("page changed")
        target.act(step.action, step.value)
        await delay(step.action === "point" ? 1800 : 650, signal)
      }
      if (signal.aborted) return
      cleanup()
      publish({
        status: "completed",
        text: "示範完成！你可以在練習單繼續試，或回訂單頁正式操作。",
        rect: null,
        clicking: false,
      })
    } catch {
      if (signal.aborted) return
      cleanup()
      publish({
        status: "failed",
        text: "這一步的畫面還沒準備好，示範已停止。你可以直接接手操作。",
        rect: null,
        clicking: false,
      })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      if (state.status === "running" || env.pathname() !== "/orders") return
      cleanup()
      controller = new AbortController()
      unlisten = env.listen(() => stop())
      publish({ ...INITIAL, status: "running", text: "熊熊滾準備示範…" })
      void run(controller.signal)
    },
    stop,
    dismiss() {
      cleanup()
      publish(INITIAL)
    },
  }
}
