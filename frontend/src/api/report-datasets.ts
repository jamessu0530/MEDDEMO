import { jsonBody, request, requestBlob } from "@/api/client"

export type DataKind = "text" | "number" | "date" | "boolean"
export type DataCell = string | number | boolean | null
export type DataColumn = { id: string; name: string; kind: DataKind }
export type DataRecipe = {
  columns: (DataColumn & { include: boolean })[]
  trim: boolean
  drop_blank: boolean
  deduplicate: boolean
  invalid: "reject" | "null"
}
export type DataChart = {
  id: string
  title: string
  visual: "bar" | "column" | "line" | "pie" | "table" | "kpi"
  group_by: string | null
  value: string | null
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "distinct"
  date_grain: "day" | "month" | "quarter" | "year"
  sort: "value_desc" | "value_asc" | "label_asc"
  limit: number
  filters: {
    column: string
    operator: "eq" | "contains" | "gte" | "lte" | "not_empty"
    value: string
  }[]
}
export type DataProfile = DataColumn & {
  empty: number
  distinct: number
  examples: string[]
  top: { value: string; count: number }[]
  sum?: number
  min?: number | null
  max?: number | null
  average?: number | null
}
export type DataPreview = {
  columns: DataColumn[]
  rows: DataCell[][]
  row_count: number
  page: number
  page_size: number
  profiles: DataProfile[]
  changes: null | {
    invalid_cells: number
    issues: { row: number; column: string; value: string }[]
    removed_blank: number
    removed_duplicates: number
    can_save: boolean
  }
}
export type DataSource = {
  id: string
  name: string
  revision: number
  origin: {
    filename: string
    sheet: string | null
    sheets: string[]
    header_row?: number
    encoding?: string
    delimiter?: string
    warnings: string[]
    sources?: { id: string; name: string; revision: number }[]
  }
  columns: DataColumn[]
  row_count: number
  recipe: DataRecipe
  charts: DataChart[]
  updated_at: string
}
export type DataDetail = DataSource & {
  preview: DataPreview
  source_columns: DataColumn[]
}
export type DataInspection = {
  origin: { filename: string; sheets: string[]; sheet: string | null }
  preview: DataPreview | null
  error: string | null
}
export type DataResult = {
  points: { label: string; value: number | null; rows: number }[]
  total: number | null
  row_count: number
  group_count: number
  has_negative: boolean
  note: string
  revision: number
}
export type DataAnalysis = {
  summary: string
  findings: string[]
  cautions: string[]
  columns: (DataColumn & { reason: string })[]
  charts: DataChart[]
  revision: number
  sample_rows: number
  total_rows: number
}

const base = "/api/reports/datasets"
const path = (id: string) => `${base}/${encodeURIComponent(id)}`
export const listDataSources = (signal?: AbortSignal) =>
  request<{ datasets: DataSource[]; ai_available: boolean }>(base, { signal })
export const getDataSource = (id: string, page = 1, signal?: AbortSignal) =>
  request<DataDetail>(`${path(id)}?page=${page}`, { signal })
export function importDataFile(
  file: File,
  options: {
    sheet?: string
    header_row: number
    encoding: string
    delimiter: string
  },
  signal?: AbortSignal
) {
  const body = new FormData()
  body.set("file", file)
  for (const [key, value] of Object.entries(options))
    body.set(key, String(value))
  return request<DataDetail>(base, { method: "POST", body, signal })
}
export function inspectDataFile(
  file: File,
  options: {
    sheet?: string
    header_row: number
    encoding: string
    delimiter: string
  },
  signal?: AbortSignal
) {
  const body = new FormData()
  body.set("file", file)
  for (const [key, value] of Object.entries(options))
    body.set(key, String(value))
  return request<DataInspection>(`${base}/inspect`, {
    method: "POST",
    body,
    signal,
  })
}
export const previewDataRecipe = (
  id: string,
  recipe: DataRecipe,
  signal?: AbortSignal
) =>
  request<DataPreview>(`${path(id)}/preview`, {
    ...jsonBody("POST", recipe),
    signal,
  })
export const saveDataSource = (
  source: DataSource,
  recipe: DataRecipe,
  charts = source.charts,
  signal?: AbortSignal
) =>
  request<DataDetail>(path(source.id), {
    ...jsonBody("PUT", {
      revision: source.revision,
      name: source.name,
      recipe,
      charts,
    }),
    signal,
  })
export const reparseDataSource = (
  id: string,
  options: {
    revision: number
    sheet: string | null
    header_row: number
    encoding: string
    delimiter: string
  }
) => request<DataDetail>(`${path(id)}/reparse`, jsonBody("POST", options))
export const mergeDataSources = (body: {
  left_id: string
  right_id: string
  left_revision: number
  right_revision: number
  name: string
  mode: "append" | "left_join"
  left_key: string | null
  right_key: string | null
}) => request<DataDetail>(`${base}/merge`, jsonBody("POST", body))
export const queryDataSource = (
  id: string,
  chart: DataChart,
  signal?: AbortSignal
) =>
  request<DataResult>(`${path(id)}/query`, {
    ...jsonBody("POST", chart),
    signal,
  })
export const analyzeDataSource = (
  id: string,
  question: string,
  signal?: AbortSignal
) =>
  request<DataAnalysis>(`${path(id)}/analyze`, {
    ...jsonBody("POST", { question }),
    signal,
  })
export const deleteDataSource = (source: DataSource) =>
  request<void>(`${path(source.id)}?revision=${source.revision}`, {
    method: "DELETE",
  })
export const exportDataSource = (id: string) =>
  requestBlob(`${path(id)}/export`)
