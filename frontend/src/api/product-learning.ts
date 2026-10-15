import { jsonBody, request } from "@/api/client"
import type { Medal, ProductMedalKind } from "@/api/me"

export type ProductCourse = {
  kind: ProductMedalKind
  category: string
  completed: number
  total: number
  lessons: { tier: 1 | 2 | 3; title: string; completed: boolean; locked: boolean; condition: string; action_path: string }[]
}
export type ProductLesson = {
  kind: ProductMedalKind
  category: string
  tier: 1 | 2 | 3
  lesson_title: string
  title: string
  condition: string
  completed: boolean
  locked: boolean
  have: number
  reference: { sku: string; name: string; category: string; spec: string; unit: string }[]
  questions: { id: string; prompt: string; choices: { value: string; label: string }[] }[]
  hint: string
}
export function getProductCourses(signal?: AbortSignal) {
  return request<ProductCourse[]>("/api/first-week/product-courses", { signal })
}
export function getProductLesson(kind: string, tier: string, signal?: AbortSignal) {
  return request<ProductLesson>(`/api/first-week/product-courses/${encodeURIComponent(kind)}/${encodeURIComponent(tier)}`, { signal })
}
export function completeProductLesson(kind: string, tier: string, answers: Record<string, string>) {
  return request<{ lesson: ProductLesson; unlocked: Medal[] }>(
    `/api/first-week/product-courses/${encodeURIComponent(kind)}/${encodeURIComponent(tier)}/complete`,
    jsonBody("POST", { answers })
  )
}
