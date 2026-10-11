import { jsonBody, request } from "@/api/client"
import type { OwnerOption, ReportConfig, ReportData } from "@/lib/reports"
import { normalizeReportConfig } from "@/lib/reports"

export type ReportWorkspace = {
  config: ReportConfig
  templates: Record<"sales" | "manager", ReportConfig>
  owners: OwnerOption[]
  ai_available: boolean
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

export function getReportData(config: ReportConfig, signal?: AbortSignal) {
  return request<ReportData>("/api/reports/data", {
    ...jsonBody("POST", config),
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
