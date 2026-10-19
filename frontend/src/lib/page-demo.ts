import type { DemoStep } from "@/lib/ui-demo"

export type PageDemoControl = {
  target: string
  label: string
  kind: "field" | "search" | "choice" | "navigation" | "action" | "heading"
  opens?: "dialog" | "disclosure"
  disabled?: boolean
  primary?: boolean
}

const COMMIT_ACTION =
  /儲存|送出|送簽|發送|刪除|移除|核准|駁回|退回|解除|重設|重置|登出|登入|註冊|套用|購買|付款|上傳|下載|接受|拒絕|撤回|撤銷|復原|錄音|建立草稿/

/** 等待主要內容，錯誤與尚未載入的說明仍可開始導覽。 */
export function pageDemoLoadingText(text: string) {
  return /^(?:正在)?(?:載入|讀取|準備|整理|規劃)(?!失敗|不了|完成).{0,80}(?:中|…|\.{3})[。！!]?$/u.test(
    text.replace(/\s+/g, " ").trim()
  )
}

/** 所有控制項預設只指向；只有原始碼標記的開啟面板與原生 details 可代點。 */
export function pageDemoCanClick(control: PageDemoControl) {
  return Boolean(
    control.opens && !control.disabled && !COMMIT_ACTION.test(control.label)
  )
}

function instruction(control: PageDemoControl) {
  const name = `「${control.label}」`
  if (control.disabled)
    return `${name}目前無法使用；完成頁面要求或取得權限後才能操作。`
  if (COMMIT_ACTION.test(control.label))
    return `${name}會執行資料或帳號操作。請核對內容後自行確認，示範只帶你看位置。`
  switch (control.kind) {
    case "heading":
      return `這是${name}。我會帶你看目前畫面上的操作，已填寫的內容會保留。`
    case "search":
      return `用${name}搜尋或縮小範圍。你目前的輸入與篩選值會保留。`
    case "field":
      return `在${name}填寫或修改資料；這次先帶看欄位，不變更你已填好的內容。`
    case "choice":
      return `從${name}切換選項或檢視方式。示範會保留目前的選擇。`
    case "navigation":
      return `按${name}可前往對應內容。需要切頁時，由你點選入口繼續。`
    default:
      return `${name}是這個頁面的操作入口。你隨時點兩下畫面或按 Esc 就能接手使用。`
  }
}

export function buildPageDemoSteps(
  page: string,
  controls: readonly PageDemoControl[]
): DemoStep[] {
  const unique = controls.filter(
    (control, index) =>
      control.label &&
      controls.findIndex(
        (other) => other.kind === control.kind && other.label === control.label
      ) === index
  )
  const opener = unique.find(pageDemoCanClick)
  const preferred = unique.toSorted(
    (a, b) => Number(!!b.primary) - Number(!!a.primary)
  )
  const points: PageDemoControl[] = []
  const counts = new Map<PageDemoControl["kind"], number>()
  const order = [
    "heading",
    "search",
    "field",
    "choice",
    "action",
    "navigation",
  ] as const
  for (const kind of order) {
    for (const control of preferred) {
      if (
        control === opener ||
        control.kind !== kind ||
        (counts.get(kind) ?? 0) >=
          (kind === "heading" || kind === "navigation" ? 1 : 2)
      )
        continue
      if (points.length >= 7) break
      points.push(control)
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  }
  const steps: DemoStep[] = points.map((control) => ({
    target: control.target,
    page,
    action: "point",
    text: instruction(control),
    optional: control.kind !== "heading",
  }))
  if (opener) {
    steps.push({
      target: opener.target,
      page,
      action: "click",
      text: `我會按「${opener.label}」展開介面，帶你看接下來的操作。`,
      optional: true,
    })
    steps.push({
      target:
        opener.opens === "dialog"
          ? "page-tour-dialog"
          : `${opener.target}-content`,
      page,
      action: "point",
      text: "這裡是剛展開的內容。你可以接著填寫或查看；儲存、送出和其他確認操作都由你完成。",
      optional: true,
    })
  }
  return steps
}

export function canTourPage(pathname: string) {
  const path = pathname.split("?")[0]
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    ![...path].some((character) => character.charCodeAt(0) < 32) &&
    !/^\/auth(?:\/|$)/.test(path)
  )
}

/** 只處理明確的操作求助；數字、原因、規定與進度問題仍交給原本的查詢。 */
export function wantsPageDemo(question: string) {
  const text = question.replace(/\s/g, "")
  if (
    /(不要|不用|不需|不想|別).{0,8}(示範|操作|點擊|點選|教我|帶我)/.test(text)
  )
    return false
  if (/(操作給我看|幫我操作|幫我點擊|帶我操作|示範操作)/.test(text)) return true
  const subject =
    /這(個|一)?(頁|畫面)/.test(text) ||
    PAGE_DESTINATIONS.some((destination) => destination.words.test(text))
  return (
    subject &&
    /(教我(用|使用|操作)|示範.{0,12}(操作|用法|怎麼用)|(怎麼|如何)(用|使用|操作|搜尋|篩選|切換|填寫)|不會(用|操作))/.test(
      text
    )
  )
}

const PAGE_DESTINATIONS: readonly {
  words: RegExp
  path: string
  family: RegExp
  catalogView?: "products" | "promotions"
}[] = [
  {
    words: /對話紀錄|對話記錄|歷史對話/,
    path: "/conversations",
    family: /^\/conversations$/,
  },
  { words: /日曆|月曆|行事曆/, path: "/calendar", family: /^\/calendar$/ },
  { words: /頻道|討論串/, path: "/channels", family: /^\/channels(?:\/|$)/ },
  { words: /商品學習/, path: "/learning/products", family: /^\/learning\// },
  { words: /新人|課程/, path: "/first-week", family: /^\/first-week(?:\/|$)/ },
  {
    words: /促銷/,
    path: "/products?view=promotions",
    family: /^\/(products|promotions)$/,
    catalogView: "promotions",
  },
  {
    words: /商品|產品|型錄/,
    path: "/products",
    family: /^\/products$/,
    catalogView: "products",
  },
  { words: /排序習慣/, path: "/route/habits", family: /^\/route\/habits$/ },
  {
    words: /調整行程|行程排序/,
    path: "/route/edit",
    family: /^\/route\/edit(?:\/|$)/,
  },
  { words: /路線|行程/, path: "/route", family: /^\/route(?:\/|$)/ },
  { words: /客戶/, path: "/customers", family: /^\/customers(?:\/|$)/ },
  { words: /方法卡/, path: "/methods", family: /^\/methods$/ },
  { words: /座騎/, path: "/rides", family: /^\/rides$/ },
  { words: /熊熊滾圖鑑|吉祥物/, path: "/mascots", family: /^\/mascots$/ },
  { words: /帳號設定|設定頁/, path: "/settings", family: /^\/settings$/ },
  { words: /組織管理|組織圖/, path: "/admin", family: /^\/admin$/ },
  { words: /主管端|團隊/, path: "/manager", family: /^\/manager$/ },
  { words: /我的狀態/, path: "/me", family: /^\/me$/ },
  { words: /登入/, path: "/login", family: /^\/login$/ },
  { words: /註冊/, path: "/register", family: /^\/register$/ },
]

export function requestedPageDemoPath(question: string, currentPath = "") {
  if (!wantsPageDemo(question)) return null
  const named = PAGE_DESTINATIONS.find((destination) =>
    destination.words.test(question)
  )
  if (named) {
    const [pathname, search] = currentPath.split("?")
    if (named.catalogView) {
      const view =
        pathname === "/promotions" ||
        new URLSearchParams(search).get("view") === "promotions"
          ? "promotions"
          : "products"
      return ["/orders", "/products", "/promotions"].includes(pathname) &&
        view === named.catalogView &&
        (pathname !== "/orders" || new URLSearchParams(search).has("view"))
        ? currentPath
        : named.path
    }
    return named.family.test(pathname) ? currentPath : named.path
  }
  return currentPath && canTourPage(currentPath) ? currentPath : null
}
