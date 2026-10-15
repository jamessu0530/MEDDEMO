import {
  normalizeReportConfig,
  reportPages,
  type ReportCard,
  type ReportConfig,
  type ReportDateRange,
  type ReportFilter,
  type ReportPage,
  type ReportPeriod,
  type ReportSlicer,
} from "@/lib/reports"

export type ReportFixedFilters = {
  filters: ReportFilter[]
  slicers: ReportSlicer[]
  date_range: ReportDateRange | null
}
export type ReportBookmarkState = ReportFixedFilters & {
  period: ReportPeriod
  owner_id: string | null
  customer_type: ReportConfig["customer_type"]
  page_id: string
  pages: (ReportFixedFilters & { id: string })[]
  cards: (ReportFixedFilters & { id: string })[]
}
export type ReportBookmark = {
  id: string
  name: string
  state: ReportBookmarkState
  updated_at: string
}
export type ReportDocumentSummary = {
  id: string
  name: string
  revision: number
  updated_at: string
  readonly?: boolean
}
export type ReportLibrarySnapshot = {
  config: ReportConfig
  account_id: string
  active_report_id: string
  revision: number
  documents: ReportDocumentSummary[]
  bookmarks: ReportBookmark[]
  readonly?: boolean
  shared_from?: {
    user_id: string
    name: string
    report_id: string
    revision: number
    shared_at: string
  } | null
}
export type ReportDraftHistory = {
  config: ReportConfig
  history: ReportConfig[]
  future: ReportConfig[]
}

export function editReportDraft(
  current: ReportDraftHistory,
  config: ReportConfig
): ReportDraftHistory {
  return JSON.stringify(current.config) === JSON.stringify(config)
    ? current
    : {
        config,
        history: [...current.history, current.config].slice(-30),
        future: [],
      }
}
export function undoReportDraft(
  current: ReportDraftHistory
): ReportDraftHistory {
  const previous = current.history.at(-1)
  return previous
    ? {
        config: previous,
        history: current.history.slice(0, -1),
        future: [...current.future, current.config].slice(-30),
      }
    : current
}
export function redoReportDraft(
  current: ReportDraftHistory
): ReportDraftHistory {
  const next = current.future.at(-1)
  return next
    ? {
        config: next,
        history: [...current.history, current.config].slice(-30),
        future: current.future.slice(0, -1),
      }
    : current
}

function fixedFilters(
  value: ReportConfig | ReportCard | ReportPage
): ReportFixedFilters {
  return {
    filters: value.filters ?? [],
    slicers: value.slicers ?? [],
    date_range: value.date_range ?? null,
  }
}
export function captureReportBookmark(
  config: ReportConfig,
  pageId: string
): ReportBookmarkState {
  return {
    ...fixedFilters(config),
    period: config.period,
    owner_id: config.owner_id,
    customer_type: config.customer_type,
    page_id: pageId,
    pages: reportPages(config).map((page) => ({
      id: page.id,
      ...fixedFilters(page),
    })),
    cards: config.cards.map((card) => ({ id: card.id, ...fixedFilters(card) })),
  }
}
export function applyReportBookmark(
  config: ReportConfig,
  state: ReportBookmarkState,
  ownerIds: string[]
): ReportConfig {
  const allowed = new Set(ownerIds)
  const safe = (value: ReportFixedFilters): ReportFixedFilters => ({
    date_range: value.date_range,
    filters: value.filters.filter(
      (item) => item.dimension !== "owner" || allowed.has(item.key)
    ),
    slicers: value.slicers
      .map((item) => ({
        ...item,
        keys:
          item.dimension === "owner"
            ? item.keys.filter((key) => allowed.has(key))
            : item.keys,
      }))
      .filter((item) => item.keys.length > 0),
  })
  return normalizeReportConfig({
    ...config,
    ...safe(state),
    period: state.period,
    owner_id:
      state.owner_id && allowed.has(state.owner_id) ? state.owner_id : null,
    customer_type: state.customer_type,
    pages: reportPages(config).map((page) => {
      const saved = state.pages.find((item) => item.id === page.id)
      return saved ? { ...page, ...safe(saved) } : page
    }),
    cards: config.cards.map((card) => {
      const saved = state.cards.find((item) => item.id === card.id)
      return saved ? { ...card, ...safe(saved) } : card
    }),
  })
}

export type ReportLocalDraft = {
  version: 1
  account_id: string
  report_id: string
  revision: number
  saved_key: string
  config: ReportConfig
  page_id: string
  updated_at: string
}
export type ReportDraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>
export function reportDraftKey(accountId: string, reportId: string) {
  return `meddemo:report-draft:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(reportId)}`
}
export function readReportLocalDraft(
  storage: ReportDraftStorage,
  accountId: string,
  reportId: string,
  now = Date.now()
): ReportLocalDraft | null {
  try {
    const raw = storage.getItem(reportDraftKey(accountId, reportId))
    if (!raw || raw.length > 600000) return null
    const value = JSON.parse(raw) as ReportLocalDraft
    const time = Date.parse(value.updated_at)
    if (
      value.version !== 1 ||
      value.account_id !== accountId ||
      value.report_id !== reportId ||
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      typeof value.saved_key !== "string" ||
      typeof value.page_id !== "string" ||
      !Number.isFinite(time) ||
      now - time > 14 * 86400000 ||
      time > now + 60000 ||
      !value.config ||
      !Array.isArray(value.config.cards) ||
      value.config.cards.length < 1 ||
      value.config.cards.length > 24
    )
      return null
    // 復原前另送後端做完整 schema 與權限驗證，這裡不直接渲染本機內容。
    return value
  } catch {
    return null
  }
}
export function writeReportLocalDraft(
  storage: ReportDraftStorage,
  draft: ReportLocalDraft
) {
  const raw = JSON.stringify(draft)
  if (raw.length > 600000)
    throw new Error("草稿超過本機儲存上限，請先儲存到帳號。")
  storage.setItem(reportDraftKey(draft.account_id, draft.report_id), raw)
}
