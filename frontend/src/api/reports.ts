import { jsonBody, request, requestBlob } from "@/api/client"
import type {
  OwnerOption,
  ReportConfig,
  ReportData,
  ReportQuery,
  ReportFilterOptions,
  ReportMetric,
  ReportSelectionPoint,
} from "@/lib/reports"
import { normalizeReportConfig } from "@/lib/reports"
import type {
  ReportBookmarkState,
  ReportLibrarySnapshot,
} from "@/lib/report-documents"

export type ReportWorkspace = {
  config: ReportConfig
  templates: Record<"sales" | "manager", ReportConfig>
  owners: OwnerOption[]
  ai_available: boolean
  filter_options?: ReportFilterOptions
  as_of?: string
  account_id?: string
  active_report_id?: string
  revision?: number
  documents?: ReportLibrarySnapshot["documents"]
  bookmarks?: ReportLibrarySnapshot["bookmarks"]
  readonly?: boolean
  shared_from?: ReportLibrarySnapshot["shared_from"]
}
export function getReportRecipients(signal?: AbortSignal) {
  return request<{ id: string; name: string }[]>(
    "/api/reports/share-recipients",
    { signal }
  )
}
export function shareReportDocument(
  reportId: string,
  recipient_id: string,
  revision: number,
  signal?: AbortSignal
) {
  return request<{
    recipient_name: string
    report_name: string
    shared_report_id: string
    updated: boolean
  }>(`/api/reports/library/${encodeURIComponent(reportId)}/share`, {
    ...jsonBody("POST", { recipient_id, revision }),
    signal,
  })
}
function normalizeLibrary(value: ReportLibrarySnapshot): ReportLibrarySnapshot {
  return { ...value, config: normalizeReportConfig(value.config) }
}
export function createReportDocument(
  config: ReportConfig,
  sourceId?: string,
  signal?: AbortSignal
) {
  return request<ReportLibrarySnapshot>("/api/reports/library", {
    ...jsonBody("POST", { config, source_id: sourceId ?? null }),
    signal,
  }).then(normalizeLibrary)
}
export function openReportDocument(report_id: string, signal?: AbortSignal) {
  return request<ReportLibrarySnapshot>("/api/reports/library/open", {
    ...jsonBody("POST", { report_id }),
    signal,
  }).then(normalizeLibrary)
}
export function saveReportDocument(
  reportId: string,
  config: ReportConfig,
  revision: number,
  signal?: AbortSignal
) {
  return request<ReportLibrarySnapshot>(
    `/api/reports/library/${encodeURIComponent(reportId)}`,
    { ...jsonBody("PUT", { config, revision }), signal }
  ).then(normalizeLibrary)
}
export function createReportBookmark(
  reportId: string,
  name: string,
  state: ReportBookmarkState,
  signal?: AbortSignal
) {
  return request<ReportLibrarySnapshot>(
    `/api/reports/library/${encodeURIComponent(reportId)}/bookmarks`,
    { ...jsonBody("POST", { name, state }), signal }
  ).then(normalizeLibrary)
}
export function validateReportDraft(
  config: ReportConfig,
  signal?: AbortSignal
) {
  return request<ReportConfig>("/api/reports/library/validate", {
    ...jsonBody("POST", { config }),
    signal,
  }).then(normalizeReportConfig)
}
export type ReportAdjustment = {
  kind: "proposal" | "clarify"
  message: string
  config: ReportConfig | null
}

export function getReports(signal?: AbortSignal) {
  return request<ReportWorkspace>("/api/reports", { signal }).then(
    (workspace) => ({
      ...workspace,
      config: normalizeReportConfig(workspace.config),
      templates: {
        sales: normalizeReportConfig(workspace.templates.sales),
        manager: normalizeReportConfig(workspace.templates.manager),
      },
    })
  )
}

export function saveReportConfig(config: ReportConfig, signal?: AbortSignal) {
  return request<ReportConfig>("/api/reports/config", {
    ...jsonBody("PUT", config),
    signal,
  }).then(normalizeReportConfig)
}

export function getReportData(config: ReportQuery, signal?: AbortSignal) {
  return request<ReportData>("/api/reports/data", {
    ...jsonBody("POST", config),
    signal,
  })
}

export type ReportExportInput = {
  config: ReportQuery
  format: "csv" | "xlsx" | "pdf"
  data: "summary" | "details"
  page_id?: string | null
  card_id?: string | null
  selection_scope?: "chart" | "selected"
  point?: ReportSelectionPoint
  sort_by?: ReportDetailsInput["sort_by"]
  sort_direction?: "asc" | "desc"
}
export function downloadReportFile(
  body: ReportExportInput,
  signal?: AbortSignal
) {
  return requestBlob("/api/reports/export", {
    ...jsonBody("POST", body),
    signal,
  })
}

export type ReportDetailsColumn = {
  key: string
  label: string
  kind: "text" | "date" | "datetime" | "currency" | "number"
  sort_key: ReportDetailsInput["sort_by"] | null
}
export type ReportDetailsInput = {
  config: ReportQuery
  card_id: string
  point?: ReportSelectionPoint | null
  selection_scope: "chart" | "selected"
  page: number
  page_size: number
  sort_by:
    | "date"
    | "amount"
    | "net_margin"
    | "customer"
    | "product"
    | "owner"
    | "order"
    | "due_date"
  sort_direction: "asc" | "desc"
}
export type ReportDetails = {
  card_id: string
  title: string
  as_of: string
  start: string
  end: string
  metric: ReportMetric
  total: number | null
  total_rows: number
  page: number
  page_size: number
  columns: ReportDetailsColumn[]
  rows: { id: string; values: Record<string, string | number | null> }[]
  note: string
}

export function getReportDetails(
  body: ReportDetailsInput,
  signal?: AbortSignal
) {
  return request<ReportDetails>("/api/reports/details", {
    ...jsonBody("POST", body),
    signal,
  })
}

export function downloadReportDetails(
  body: ReportDetailsInput,
  signal?: AbortSignal
) {
  return requestBlob("/api/reports/details/export", {
    ...jsonBody("POST", body),
    signal,
  })
}

export function adjustReport(
  question: string,
  config: ReportConfig,
  signal?: AbortSignal
) {
  return request<ReportAdjustment>("/api/reports/adjust", {
    ...jsonBody("POST", { question, config }),
    signal,
  }).then((result) => ({
    ...result,
    config: result.config ? normalizeReportConfig(result.config) : null,
  }))
}
