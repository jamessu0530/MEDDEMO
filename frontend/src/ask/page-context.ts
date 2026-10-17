import { pagePromptsFor, type PagePrompts } from "@/ask/page-prompts"

/** 頁面只提供提問線索，實際查詢仍由後端依登入權限執行。 */
export type AskPageContext = { path: string; title: string; facts: string[] }
export type PageDetails = {
  title?: string
  facts?: string[]
  suggestions?: string[]
  hint?: string
  followUps?: string[]
}
export type AssistantPage = AskPageContext & PagePrompts

function decodePath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function pageContextFor(pathname: string, search = ""): AssistantPage {
  const params = new URLSearchParams(search)
  const path = pathname.replace(/\/$/, "") || "/"
  const parts = path.split("/").filter(Boolean)
  let title = "目前頁面"
  let facts: string[] = []
  if (
    parts[0] === "orders" ||
    parts[0] === "products" ||
    parts[0] === "promotions"
  ) {
    const view =
      parts[0] === "orders"
        ? params.get("view")
        : parts[0] === "promotions"
          ? "promotions"
          : params.get("view") || "products"
    title =
      view === "products"
        ? "商品型錄"
        : view === "promotions"
          ? "促銷方案"
          : "銷售訂單"
    if (parts[1] === "new") title = "新增訂單"
    else if (parts[1]) {
      title = parts[1] === "demo" ? "訂單操作練習" : "訂單明細"
      facts.push(`訂單編號：${parts[1]}`)
    }
    if (params.get("customer_id"))
      facts.push(`客戶編號：${params.get("customer_id")}`)
  } else if (parts[0] === "customers") {
    title = parts[1] ? "客戶檔案" : "客戶清單"
    if (parts[1]) {
      facts = [`客戶編號：${parts[1]}`]
      const subpages: Record<string, string> = {
        quote: "客戶報價",
        contract: "客戶合約",
        record: "拜訪錄音",
        negotiation: "客戶談判",
      }
      title = subpages[parts[2]] ?? title
    }
  } else if (parts[0] === "channels") {
    title =
      parts[1] === "search"
        ? "頻道搜尋"
        : parts[2] === "threads"
          ? "客戶討論串清單"
          : parts[1]
            ? "頻道對話"
            : "頻道"
    if (parts[1] && parts[1] !== "search") facts.push(`頻道編號：${parts[1]}`)
  } else if (parts[0] === "oa") {
    title =
      parts[1] === "apps"
        ? "OA 表單中心"
        : parts[1] === "new" || parts[3] === "edit"
          ? "OA 表單填寫"
          : parts[2]
            ? "OA 申請明細"
            : "我的申請單"
    facts = ["OA 表單支援預填、草稿、缺件檢查與主管簽核。"]
    if (parts[1] === "new" && parts[2])
      facts.push(`表單種類：${decodePath(parts[2])}`)
    if (parts[1] === "forms" && parts[2]) facts.push(`申請單編號：${parts[2]}`)
    if (params.get("application"))
      facts.push(`應用篩選：${params.get("application")}`)
  } else if (parts[0] === "manager") {
    const views: Record<string, string> = {
      priority: "客戶策略",
      featured: "主推品項",
      oa: "簽核",
      methods: "方法卡",
    }
    title = views[params.get("view") ?? ""] ?? "團隊行程"
  } else {
    const titles: Record<string, string> = {
      route: "今日路線",
      calendar: "日曆",
      reports: "報表",
      methods: "方法卡",
      me: "我的狀態",
      conversations: "對話紀錄",
      settings: "帳號設定",
      "first-week": "新人課程",
      learning: "商品學習",
      documents: "內部文件",
      visits: "拜訪紀錄",
      oa: "申請單",
      admin: "組織管理",
      rides: "座騎圖鑑",
      mascots: "熊熊滾圖鑑",
      login: "登入",
      register: "註冊",
      privacy: "隱私權政策",
      auth: "帳號授權",
    }
    title = titles[parts[0]] ?? title
    if (parts[0] === "documents" && parts[1])
      facts.push(`文件：${decodePath(parts[1])}`)
    if (parts[0] === "visits" && parts[1])
      facts.push(`拜訪紀錄編號：${parts[1]}`)
    if (parts[0] === "route") {
      title =
        parts[1] === "habits"
          ? "我的排序習慣"
          : parts[2] === "add"
            ? "行程加一站"
            : parts[1] === "edit"
              ? "調整行程"
              : title
    }
  }
  // 授權回呼網址可能帶一次性 code；只提供頁面名稱，不把憑證送進對話。
  return {
    path: `${path}${parts[0] === "auth" ? "" : search}`.slice(0, 300),
    title,
    facts,
    ...pagePromptsFor(path, search),
  }
}

export function mergePageContext(
  base: AssistantPage,
  details: PageDetails[]
): AssistantPage {
  return details.reduce<AssistantPage>(
    (page, detail) => ({
      ...page,
      title: detail.title?.slice(0, 120) || page.title,
      facts: [
        ...new Set([...page.facts, ...(detail.facts ?? []).filter(Boolean)]),
      ]
        .slice(0, 16)
        .map((fact) => fact.slice(0, 500)),
      suggestions: detail.suggestions ?? page.suggestions,
      hint: detail.hint ?? page.hint,
      followUps: detail.followUps ?? page.followUps,
    }),
    base
  )
}

/** 每個註冊有自己的 token，舊頁面的 cleanup 不會清掉新頁面的情境。 */
export function createPageContexts() {
  let entries: { token: symbol; key: string; details: PageDetails }[] = []
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    register(key: string, details: PageDetails) {
      const token = Symbol()
      entries = [...entries, { token, key, details }]
      emit()
      return () => {
        entries = entries.filter((entry) => entry.token !== token)
        emit()
      }
    },
    clear() {
      entries = []
      emit()
    },
  }
}
