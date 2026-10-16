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
      createElement(CoursePath, { course: state, onCourseChange: () => {} })
    )
  )
}

describe("Demo 跳過新人課程", () => {
  it("展示設定開啟時提供跳過按鈕，關閉時仍須通關", () => {
    expect(render(course)).toContain("Demo：跳過課程，直接使用 AI")
    const normal = render({ ...course, demo_skip_available: false })
    expect(normal).not.toContain("Demo：跳過課程")
    expect(normal).toContain("通關獎勵：AI 問答")
    expect(normal).not.toContain('href="/ask"')
  })

  it("略過後可進 AI，仍顯示真實進度與尚未完成的課程", () => {
    const skipped = render({ ...course, ai_unlocked: true, demo_skipped: true })
    expect(skipped).toContain("Demo · AI 問答已開啟")
    expect(skipped).toContain('href="/ask"')
    expect(skipped).toContain("20 XP")
    expect(skipped).toContain("繼續闖關")
    expect(skipped).not.toContain("第一章完成！")
    expect(skipped).not.toContain("Demo：跳過課程")
  })
})
