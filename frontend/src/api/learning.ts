import { jsonBody, request } from "@/api/client"

export type Lesson = {
  id: string
  title: string
  description: string
  skill: string
  minutes: number
}
export type Course = {
  available: boolean
  is_newcomer: boolean
  completed: string[]
  xp: number
  ai_unlocked: boolean
  lessons: Lesson[]
}
export type LessonAnswer = Record<string, string | boolean | string[]>

export function getCourse(signal?: AbortSignal) {
  return request<Course>("/api/first-week/course", { signal })
}

export function completeLesson(lessonId: string, answer: LessonAnswer) {
  return request<Course>(
    `/api/first-week/course/${encodeURIComponent(lessonId)}/complete`,
    jsonBody("POST", { answer })
  )
}
