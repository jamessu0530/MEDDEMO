import {
  canTourPage,
  requestedPageDemoPath,
  wantsPageDemo,
} from "@/lib/page-demo"

export type DemoRect = { x: number; y: number; width: number; height: number }
export type DemoStep = {
  target: string
  page: string | readonly string[]
  text: string
  action: "click" | "fill" | "point"
  value?: string
  optional?: boolean
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
    action: "point",
    text: "先核對從客戶清單帶入的客戶；也可以切換成其他客戶。",
  },
  {
    target: "practice-payment-term",
    page: "/orders",
    action: "fill",
    value: "RCD2",
    text: "這張練習單先選「RCD2 隔月匯款」。正式建立訂單時，請核對本次付款條件。",
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
    action: "point",
    text: "在這裡核對收貨地址，資料未提供時請自行補齊。",
  },
  {
    target: "practice-recipient",
    page: "/orders/demo",
    action: "point",
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

export type UiDemoKind =
  "create-order" | "report-tour" | "oa-tour" | "page-tour"

/** Report actions open the real interface; condition changes and downloads stay with the user. */
export const REPORT_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "report-period",
    page: "/reports",
    action: "point",
    text: "從這裡切換本月、上個月或自訂日期。示範會保留你目前選的期間。",
  },
  {
    target: "report-filters",
    page: "/reports",
    action: "click",
    text: "按篩選，展開報表條件。手機會從底部開啟面板。",
  },
  {
    target: "report-filter-period",
    page: "/reports",
    action: "point",
    text: "面板裡可以調整期間，再往下選業務、客戶或商品。這次先不變更條件。",
  },
  {
    target: "report-sheet-done",
    page: "/reports",
    action: "click",
    text: "按「完成」收起篩選面板，回到數據。",
  },
  {
    target: "report-page-tabs",
    page: "/reports",
    action: "point",
    optional: true,
    text: "報表分頁在最上方；手機可以左右滑動切換，不必捲到最下面。",
  },
  {
    target: "report-visual-edit",
    page: "/reports",
    action: "click",
    optional: true,
    text: "長按任一報表就能拖移，只有該張卡片會浮起；修改會自動儲存。按圖表設定可調整指標與格式。",
  },
  {
    target: "report-widget-resize",
    page: "/reports",
    action: "point",
    optional: true,
    text: "拖曳卡片右下角的毛玻璃把手調整大小，內容會依空間自動切換。這次只指出位置。",
  },
  {
    target: "report-inspector",
    page: "/reports",
    action: "point",
    optional: true,
    text: "手機的設定從底部展開；桌機則顯示在側邊。這次只帶你看位置。",
  },
  {
    target: "report-inspector-close",
    page: "/reports",
    action: "click",
    optional: true,
    text: "先收起圖表設定，保留原有內容。",
  },
  {
    target: "report-more",
    page: "/reports",
    action: "click",
    text: "其他功能收在右上角的更多操作裡。",
  },
  {
    target: "report-export",
    page: "/reports",
    action: "click",
    text: "按「完整匯出」，開啟匯出設定。",
  },
  {
    target: "report-export-format",
    page: "/reports",
    action: "point",
    text: "在這裡選 Excel、CSV 或 PDF，並確認要匯出的範圍與內容。",
  },
  {
    target: "report-export-download",
    page: "/reports",
    action: "point",
    optional: true,
    text: "確認格式與範圍後，由你按「下載完整檔案」。示範不會自動下載。",
  },
]

const OA_EDITOR_PAGES = ["/oa/new/:code", "/oa/forms/:formId/edit"] as const

/** OA 只導覽與指向操作位置，不填入資料、不儲存或送出申請。 */
export const OA_EDITOR_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "oa-assistant-content",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "把申請內容貼在這裡，再按「依內容預填空白欄位」。整理後仍可逐欄修改。",
  },
  {
    target: "oa-fill-known",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "按這裡帶入已有的帳號資料；未提供的欄位保留空白，也會保留你目前的內容。",
  },
  {
    target: "oa-customer",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "在這裡搜尋並選擇客戶。是否必填會依表單標示。",
  },
  {
    target: "oa-form-field",
    page: OA_EDITOR_PAGES,
    action: "point",
    optional: true,
    text: "依表單填寫公司、部門和申請資料；星號代表必填，欄位下方會標示資料來源。",
  },
  {
    target: "oa-purpose",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "最後補上申請目的，核對原因、用途與需要協助的事項。",
  },
  {
    target: "oa-missing",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "「送出前確認」會列出缺少的必填資料；補齊後仍需核對金額、日期與單號。",
  },
  {
    target: "oa-save-draft",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "還沒填完可以按「儲存草稿」，之後從我的申請單繼續填寫。這次只帶你看位置。",
  },
  {
    target: "oa-submit-area",
    page: OA_EDITOR_PAGES,
    action: "point",
    text: "資料齊全後，由你按「送出申請」進入本站簽核。示範不會替你儲存或送出。",
  },
]

export const OA_APPS_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "oa-template-search",
    page: "/oa/apps",
    action: "point",
    text: "表單中心可以用名稱、代碼或用途搜尋申請表單。",
  },
  {
    target: "oa-template-categories",
    page: "/oa/apps",
    action: "point",
    text: "也能依分類縮小範圍。查詢專用入口會標示為查詢報銷清單。",
  },
  {
    target: "oa-create-template",
    page: "/oa/apps",
    action: "click",
    text: "先開啟目前畫面上的第一張可建立表單，看看填寫介面；這一步還不會建立儲存紀錄。",
  },
  ...OA_EDITOR_DEMO_STEPS,
]

export const OA_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "oa-statuses",
    page: "/oa/forms",
    action: "point",
    text: "我的申請單依草稿、審核中、退回、駁回和批准顯示筆數，點狀態就能篩選。",
  },
  {
    target: "oa-open-filters",
    page: "/oa/forms",
    action: "click",
    optional: true,
    text: "手機上先按「搜尋與篩選」，展開查詢條件。",
  },
  {
    target: "oa-filters",
    page: "/oa/forms",
    action: "point",
    text: "用公司、部門、應用、日期或關鍵字搜尋申請單。這次只帶你看位置。",
  },
  {
    target: "oa-form-card",
    page: "/oa/forms",
    action: "point",
    optional: true,
    text: "點申請單可以查看內容、簽核流程和活動日誌；草稿或退回的表單可繼續填寫。",
  },
  {
    target: "oa-create-application",
    page: "/oa/forms",
    action: "click",
    text: "按「建立申請」進入表單中心。",
  },
  ...OA_APPS_DEMO_STEPS,
]

export const OA_DETAIL_DEMO_STEPS: readonly DemoStep[] = [
  {
    target: "oa-detail-tabs",
    page: "/oa/forms/:formId",
    action: "point",
    text: "這裡可以切換表單、附件、意見、簽核流程和活動日誌。示範會保留你目前的分頁。",
  },
  {
    target: "oa-detail-summary",
    page: "/oa/forms/:formId",
    action: "point",
    optional: true,
    text: "表單頁會列出申請人、狀態與申請內容，方便核對這張單的資料。",
  },
  {
    target: "oa-edit-draft",
    page: "/oa/forms/:formId",
    action: "point",
    optional: true,
    text: "可編輯的草稿或退回單會出現這個入口，按下即可補齊內容後重新送出。",
  },
  {
    target: "oa-flow-tab",
    page: "/oa/forms/:formId",
    action: "point",
    text: "切到「簽核流程」可查看各關卡的簽核人與處理進度。",
  },
  {
    target: "oa-activity-tab",
    page: "/oa/forms/:formId",
    action: "point",
    text: "「活動日誌」能查看處理紀錄。要繼續操作時，碰一下畫面就能接手。",
  },
]

type DemoPreset = {
  path: string
  paths: readonly string[]
  steps: readonly DemoStep[]
  description: string
  note: string
  completed: string
  entries?: readonly { page: DemoStep["page"]; steps: readonly DemoStep[] }[]
}
export const UI_DEMOS: Record<UiDemoKind, DemoPreset> = {
  "page-tour": {
    path: "/",
    paths: [],
    steps: [],
    description:
      "我會依目前頁面的實際介面，帶你看搜尋、填寫、選項和功能入口，並示範展開可用的面板。",
    note: "保留已填內容；儲存、送出、刪除與帳號操作由你確認。碰一下畫面即可接手。",
    completed: "示範完成！你可以從目前畫面繼續操作，需要時再請我帶你看。",
  },
  "create-order": {
    path: "/orders",
    paths: ["/orders", "/orders/demo"],
    steps: ORDER_DEMO_STEPS,
    description:
      "我會用紫色箭頭示範新增訂單。你隨時碰一下畫面、捲動或按鍵，我就停下來，換你操作。",
    note: "使用練習資料，最後的發送步驟會留給你確認。",
    completed: "示範完成！你可以在練習單繼續試，或回訂單頁正式操作。",
  },
  "report-tour": {
    path: "/reports",
    paths: ["/reports"],
    steps: REPORT_DEMO_STEPS,
    description:
      "我會用紫色箭頭帶你操作新版報表：篩選、查看數值、編輯與匯出。碰一下畫面就能接手。",
    note: "會開啟面板，不更動報表條件，也不會替你儲存或下載。",
    completed: "示範完成！你可以繼續選擇匯出格式，或關閉視窗回到報表。",
  },
  "oa-tour": {
    path: "/oa/forms",
    paths: ["/oa/forms", "/oa/apps", ...OA_EDITOR_PAGES, "/oa/forms/:formId"],
    steps: OA_DEMO_STEPS,
    entries: [
      { page: "/oa/apps", steps: OA_APPS_DEMO_STEPS },
      { page: OA_EDITOR_PAGES, steps: OA_EDITOR_DEMO_STEPS },
      { page: "/oa/forms/:formId", steps: OA_DETAIL_DEMO_STEPS },
    ],
    description:
      "我會用紫色箭頭帶你看新版我的申請單、選表單、預填與缺漏檢查。若正在填寫，會從目前這張表單開始。",
    note: "保留已填內容；儲存草稿、送出與簽核都由你操作。碰一下畫面即可接手。",
    completed:
      "示範完成！你可以從目前的畫面繼續操作；儲存、送出或簽核都由你確認。",
  },
}

/** 只比對已寫在本機教學裡的路由樣式，每個參數只接受一個路徑片段。 */
export function matchesDemoPage(
  page: DemoStep["page"],
  pathname: string
): boolean {
  const parts = pathname.split("?")[0].replace(/\/$/, "").split("/")
  return (typeof page === "string" ? [page] : page).some((pattern) => {
    const expected = pattern.split("/")
    return (
      expected.length === parts.length &&
      expected.every((part, index) =>
        part.startsWith(":") ? Boolean(parts[index]) : part === parts[index]
      )
    )
  })
}

export function canStartUiDemo(kind: UiDemoKind, pathname: string) {
  if (kind === "page-tour") return canTourPage(pathname)
  const preset = UI_DEMOS[kind]
  return (
    matchesDemoPage(preset.path, pathname) ||
    Boolean(
      preset.entries?.some((entry) => matchesDemoPage(entry.page, pathname))
    )
  )
}

export function isUiDemoKind(value: unknown): value is UiDemoKind {
  return typeof value === "string" && Object.hasOwn(UI_DEMOS, value)
}

export function wantsOaDemo(question: string, pagePath = "") {
  const text = question.replace(/\s/g, "")
  const oaPage = /^\/oa(?:\/|$)/.test(pagePath)
  if (
    !/(我的申請單|申請單|申請表|OA表單|OA申請|我的應用|表單中心|填表)/i.test(
      text
    ) &&
    !(
      oaPage &&
      /(這(個|一|張)?(頁|畫面|表單|單)|預填|空白範例|存草稿|送出|缺漏|不會用)/.test(
        text
      )
    )
  )
    return false
  if (/(不要|不用|不需|不想|別).{0,6}(示範|操作|教我|帶我)/.test(text))
    return false
  return /(教我|帶我|示範|操作給我看|幫我操作|不會(用|操作|填|建立|新增|儲存|送出)|不知道怎麼(用|操作|填|建立|新增|儲存|送出)|(怎麼|如何)(使用|操作|填|建立|新增|儲存|存草稿|送出|查詢|搜尋|篩選|看進度|查進度|修改|補件|用))/.test(
    text
  )
}

export function wantsReportDemo(question: string, pagePath = "") {
  const text = question.replace(/\s/g, "")
  const reportPage = pagePath.split("?")[0].replace(/\/$/, "") === "/reports"
  if (
    !/(報表|業績總覽)/.test(text) &&
    !(reportPage && /(這(個|一)?(頁|畫面)|篩選|期間|編輯|匯出)/.test(text))
  )
    return false
  if (/(不要|不用|不需|不想|別).{0,6}(示範|操作|教我|帶我)/.test(text))
    return false
  return /(教我|帶我|示範|操作給我看|幫我操作|不會(用|操作|篩選|編輯|匯出)|不知道怎麼(用|操作|篩選|編輯|匯出)|(怎麼|如何)(使用|操作|篩選|編輯|匯出|切換|開啟|看明細|用))/.test(
    text
  )
}

export function requestedUiDemo(
  question: string,
  pagePath = ""
): UiDemoKind | null {
  // 要求文字解釋時讓後端以完整語意判斷，避免「說明怎麼用」直接啟動示範。
  if (/解釋|說明|介紹|講一下|告訴我/.test(question)) return null
  if (wantsReportDemo(question, pagePath)) return "report-tour"
  if (wantsOaDemo(question, pagePath)) return "oa-tour"
  if (wantsOrderDemo(question)) return "create-order"
  const path = requestedPageDemoPath(question, pagePath)
  if (path) {
    const [pathname, query] = path.split("?")
    return uiDemoKindForPage(pathname, query ? `?${query}` : "")
  }
  return !pagePath && wantsPageDemo(question) ? "page-tour" : null
}

export function uiDemoKindForPage(pathname: string, search = ""): UiDemoKind {
  if (matchesDemoPage("/reports", pathname)) return "report-tour"
  if (/^\/oa(?:\/|$)/.test(pathname) && canStartUiDemo("oa-tour", pathname))
    return "oa-tour"
  if (
    matchesDemoPage("/orders", pathname) &&
    !["products", "promotions"].includes(
      new URLSearchParams(search).get("view") ?? ""
    )
  )
    return "create-order"
  return "page-tour"
}

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
  kind: UiDemoKind
  runId: number
  pageKey: string
  total: number
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
  location?: () => string
  pageSteps?: () => readonly DemoStep[]
  target: (id: string) => DemoTarget | null
  listen: (interrupt: () => void) => () => void
}

export const isUserTakeover = (event: Pick<Event, "type" | "isTrusted">) =>
  event.isTrusted &&
  ["pointerdown", "touchstart", "wheel", "keydown", "click"].includes(
    event.type
  )

const INITIAL: DemoState = {
  kind: "create-order",
  runId: 0,
  pageKey: "",
  total: ORDER_DEMO_STEPS.length,
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
  steps?: readonly DemoStep[]
) {
  let state = INITIAL
  let runId = 0
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
  async function run(
    signal: AbortSignal,
    preset: DemoPreset,
    activeSteps: readonly DemoStep[]
  ) {
    try {
      if (state.kind === "page-tour" && !activeSteps.length) {
        for (let attempt = 0; attempt < 120 && !activeSteps.length; attempt++) {
          await delay(100, signal)
          if ((env.location?.() ?? env.pathname()) !== state.pageKey)
            throw new Error("page changed")
          activeSteps = env.pageSteps?.() ?? []
        }
        if (!activeSteps.length) throw new Error("page unavailable")
        publish({ total: activeSteps.length })
      }
      for (const [index, step] of activeSteps.entries()) {
        const samePage = () =>
          matchesDemoPage(step.page, env.pathname()) &&
          (state.kind !== "page-tour" ||
            (env.location?.() ?? env.pathname()) === state.pageKey)
        if (state.kind === "page-tour" && !samePage())
          throw new Error("page changed")
        if (step.optional && samePage() && !env.target(step.target)) continue
        publish({ step: index + 1, text: step.text, clicking: false })
        let target: DemoTarget | null = null
        for (let attempt = 0; attempt < 120; attempt++) {
          if (signal.aborted) return
          if (samePage()) target = env.target(step.target)
          if (target) break
          await delay(100, signal)
        }
        if (!target) throw new Error("target unavailable")
        target.scroll()
        await delay(200, signal)
        publish({ rect: target.rect() })
        await delay(1400, signal)
        if (signal.aborted) return
        if (!samePage() || !target.connected()) throw new Error("page changed")
        publish({ rect: target.rect(), clicking: step.action !== "point" })
        await delay(220, signal)
        if (signal.aborted) return
        if (!samePage() || !target.connected()) throw new Error("page changed")
        target.act(step.action, step.value)
        await delay(step.action === "point" ? 1800 : 650, signal)
      }
      if (signal.aborted) return
      cleanup()
      publish({
        status: "completed",
        text: preset.completed,
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
    start(kind: UiDemoKind = "create-order") {
      const preset = UI_DEMOS[kind]
      if (state.status === "running" || !canStartUiDemo(kind, env.pathname()))
        return
      cleanup()
      controller = new AbortController()
      unlisten = env.listen(() => stop())
      const activeSteps =
        steps ??
        (kind === "page-tour" ? [] : undefined) ??
        preset.entries?.find((entry) =>
          matchesDemoPage(entry.page, env.pathname())
        )?.steps ??
        preset.steps
      publish({
        ...INITIAL,
        kind,
        runId: ++runId,
        pageKey: env.location?.() ?? env.pathname(),
        total: activeSteps.length,
        status: "running",
        text: "熊熊滾準備示範…",
      })
      void run(controller.signal, preset, activeSteps)
    },
    stop,
    dismiss() {
      cleanup()
      publish(INITIAL)
    },
  }
}
