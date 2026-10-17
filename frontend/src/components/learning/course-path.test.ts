import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { Course } from "@/api/learning"
import { CoursePath } from "@/components/learning/course-path"

const course: Course = {
  available: true,
  is_newcomer: true,
  completed: ["customer-v1"],
  xp: 20,
  ai_unlocked: false,
  demo_skip_available: true,
  demo_skipped: false,
  lessons: ["customer-v1", "product-v1", "route-v1"].map((id) => ({
    id,
    title: id,
    description: "",
    skill: "",
    minutes: 2,
  })),
}

function render(state: Course) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CoursePath, { course: state })
    )
  )
}

describe("選修新人課程", () => {
  it("即使舊伺服器回傳尚未解鎖，零進度仍可直接問 AI", () => {
    const html = render({ ...course, completed: [], xp: 0, ai_unlocked: false })
    expect(html).toContain("AI 問答隨時可用")
    expect(html).toContain("問熊熊滾")
    expect(html).toContain("開始第一關")
    expect(html).not.toContain("Demo：跳過課程")
    expect(html).not.toContain("通關獎勵：AI 問答")
  })

  it("保留真實課程進度，完成前仍可繼續闖關", () => {
    const html = render({ ...course, ai_unlocked: true, demo_skipped: true })
    expect(html).toContain("20 XP")
    expect(html).toContain("繼續闖關")
    expect(html).toContain("AI 問答隨時可用")
    expect(html).not.toContain("第一章完成！")
  })
})
