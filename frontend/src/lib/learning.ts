import type { Course, LessonAnswer } from "@/api/learning"

export function initialAnswer(lessonId: string): LessonAnswer {
  switch (lessonId) {
    case "customer-v1":
      return { opened: false, priority: "" }
    case "product-v1":
      return { view: "products", sku: "", quantity: "" }
    case "route-v1":
      return { order: ["pharmacy", "clinic"] }
    case "visit-v1":
      return { reviewed: false, competitor: "御松田", intent: "魚油 20 盒" }
    case "ask-v1":
      return { asked: false, source_opened: false, action: "" }
    default:
      return {}
  }
}

export function lessonState(
  course: Course,
  lessonId: string
): "done" | "current" | "locked" {
  const index = course.lessons.findIndex((lesson) => lesson.id === lessonId)
  if (index < 0) return "locked"
  if (course.completed.includes(lessonId)) return "done"
  return course.lessons
    .slice(0, index)
    .every((lesson) => course.completed.includes(lesson.id))
    ? "current"
    : "locked"
}

export function nextLesson(course: Course) {
  return (
    course.lessons.find((lesson) => !course.completed.includes(lesson.id)) ??
    null
  )
}
