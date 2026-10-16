import {
  Check,
  ChevronRight,
  Clock3,
  FileCheck2,
  GraduationCap,
  LockKeyhole,
  MapPin,
  MessageCircleQuestion,
  Package,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "@/components/icons"
import { Link } from "react-router"

import type { Course } from "@/api/learning"
import { DemoLearningSkip } from "@/components/learning/demo-skip"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { lessonState, nextLesson } from "@/lib/learning"
import { cn } from "@/lib/utils"

const ICONS: LucideIcon[] = [
  MapPin,
  Package,
  GraduationCap,
  FileCheck2,
  MessageCircleQuestion,
]

export function CoursePath({
  course,
  onCourseChange,
}: {
  course: Course
  onCourseChange: (course: Course) => void
}) {
  const next = nextLesson(course)
  const finished = !next
  return (
    <section className="flex flex-col gap-5" aria-label="新人操作課程">
      <div className="rounded-3xl border-2 border-primary/25 bg-primary/10 p-5 shadow-lip-primary-soft">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-primary">
            新手訓練 · 第一章
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold text-warning">
            <Sparkles className="size-4" />
            {course.xp} XP
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-semibold">跟熊熊滾，練一趟拜訪</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              每關練一個操作，做對就往前走。五關完成，解鎖 AI 問答。
            </p>
          </div>
          <Mascot
            state={finished ? "yay" : "hi"}
            size={88}
            className="shrink-0"
          />
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {finished ? "第一章完成！" : "約 11 分鐘，隨時可以接著練"}
          </span>
          <span>
            {course.completed.length} / {course.lessons.length} 關
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="課程進度"
          aria-valuemin={0}
          aria-valuemax={course.lessons.length}
          aria-valuenow={course.completed.length}
          className="mt-2 h-3 overflow-hidden rounded-full bg-card"
        >
          <div
            className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
            style={{
              width: `${(course.completed.length / Math.max(course.lessons.length, 1)) * 100}%`,
            }}
          />
        </div>
        {next && (
          <Button asChild className="mt-5 h-12 w-full text-base">
            <Link to={`/first-week/lessons/${next.id}`}>
              {course.completed.length ? "繼續闖關" : "開始第一關"}
              <ChevronRight />
            </Link>
          </Button>
        )}
        {!course.ai_unlocked && course.demo_skip_available && (
          <div className="mt-4 flex justify-center">
            <DemoLearningSkip onSkipped={onCourseChange} />
          </div>
        )}
      </div>

      <div className="relative flex flex-col gap-7 py-3">
        <div
          aria-hidden
          className="absolute top-10 bottom-10 left-9 border-l-4 border-dashed border-primary/20"
        />
        {course.lessons.map((lesson, index) => {
          const state = lessonState(course, lesson.id)
          const Icon =
            state === "done"
              ? Check
              : state === "locked"
                ? LockKeyhole
                : (ICONS[index] ?? GraduationCap)
          const contents = (
            <>
              <span
                className={cn(
                  "relative z-1 flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-background",
                  state === "locked"
                    ? "bg-muted text-muted-foreground shadow-lip-node-idle"
                    : "bg-primary text-white shadow-lip-node"
                )}
              >
                <Icon className="size-7" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span
                  className={cn(
                    "block text-xs",
                    state === "current"
                      ? "font-semibold text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {state === "done"
                    ? "已完成 · 可以再練"
                    : state === "current"
                      ? "輪到這一關"
                      : `第 ${index + 1} 關 · 完成前一關開啟`}
                </span>
                <span className="mt-1 block font-semibold">{lesson.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {lesson.description}
                </span>
                <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="size-3" />
                  {lesson.minutes} 分鐘
                  <span className="ml-2 text-warning">+20 XP</span>
                </span>
              </span>
            </>
          )
          return state === "locked" ? (
            <div
              key={lesson.id}
              className="flex items-center gap-4 px-1 opacity-65"
            >
              {contents}
            </div>
          ) : (
            <Link
              key={lesson.id}
              to={`/first-week/lessons/${lesson.id}`}
              className="flex items-center gap-4 rounded-2xl px-1 py-2 outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {contents}
              <ChevronRight className="size-4 shrink-0 text-primary" />
            </Link>
          )
        })}
      </div>

      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border-2 p-4",
          course.ai_unlocked
            ? "border-success/25 bg-success/10"
            : "border-dashed bg-card"
        )}
      >
        {course.ai_unlocked ? (
          <Trophy className="size-6 shrink-0 text-success" />
        ) : (
          <LockKeyhole className="size-6 shrink-0 text-muted-foreground" />
        )}
        <div>
          <h3 className="font-semibold">
            {course.demo_skipped
              ? "Demo · AI 問答已開啟"
              : course.ai_unlocked
                ? "AI 問答已解鎖"
                : "通關獎勵：AI 問答"}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {course.ai_unlocked
              ? "打字或用語音查數字、查規定，記得核對答案出處。"
              : `再完成 ${course.lessons.length - course.completed.length} 關，就能用打字與語音問熊熊滾。`}
          </p>
          {course.ai_unlocked && (
            <Link
              to="/ask"
              className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-success"
            >
              去問熊熊滾
              <ChevronRight className="size-4" />
            </Link>
          )}
        </div>
      </div>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        練習使用虛構情境，不會送出正式紀錄。過關進度跟著帳號保存。
      </p>
    </section>
  )
}
