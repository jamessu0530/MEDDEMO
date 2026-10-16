import { describe, expect, it } from "vitest"
import type { Course } from "@/api/learning"
import { lessonState, nextLesson } from "@/lib/learning"

const course: Course = {
  available: true,
  is_newcomer: true,
  completed: [],
  xp: 0,
  ai_unlocked: false,
  demo_skip_available: false,
  demo_skipped: false,
  lessons: ["customer-v1", "product-v1", "route-v1"].map((id) => ({
    id,
    title: id,
    description: "",
    skill: "",
    minutes: 2,
  })),
}

describe("新人課程順序", () => {
  it("先開第一關，過關後才開下一關，完成的可以複習", () => {
    expect(lessonState(course, "customer-v1")).toBe("current")
    expect(lessonState(course, "product-v1")).toBe("locked")
    const progressed = { ...course, completed: ["customer-v1"] }
    expect(lessonState(progressed, "customer-v1")).toBe("done")
    expect(lessonState(progressed, "product-v1")).toBe("current")
    expect(nextLesson(progressed)?.id).toBe("product-v1")
  })

  it("未知關卡與少了前置課程的關卡不開放", () => {
    expect(lessonState(course, "missing")).toBe("locked")
    expect(
      lessonState({ ...course, completed: ["product-v1"] }, "route-v1")
    ).toBe("locked")
    expect(nextLesson({ ...course, completed: ["product-v1"] })?.id).toBe(
      "customer-v1"
    )
  })

  it("全部完成後沒有下一關，過期的進度不影響目前課程", () => {
    expect(
      nextLesson({
        ...course,
        completed: course.lessons.map((lesson) => lesson.id),
      })
    ).toBeNull()
    expect(nextLesson({ ...course, completed: ["retired-lesson"] })?.id).toBe(
      "customer-v1"
    )
  })
})
