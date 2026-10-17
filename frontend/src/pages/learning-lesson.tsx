import { openAssistant } from "@/ask/assistant-window"
import { useEffect, useRef, useState } from "react"
import { CheckCircle2, ChevronRight, Lightbulb, Sparkles } from "@/components/icons"
import { Link, useParams } from "react-router"

import { ApiError } from "@/api/client"
import {
  completeLesson,
  getCourse,
  type Course,
  type LessonAnswer,
} from "@/api/learning"
import { Exercise } from "@/components/learning/exercises"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { celebrateCompletion } from "@/lib/completion-celebration"
import { initialAnswer, lessonState, nextLesson } from "@/lib/learning"

const TIPS: Record<string, string> = {
  "customer-v1":
    "先履行答應過的事，再談這次的產品；檔案裡沒有逾期帳款，就不用催款。",
  "product-v1": "買 10 送 2，總共到貨 12 盒。付費量和搭贈量要分開看。",
  "route-v1":
    "調整順路以前，先守住約好的拜訪時間。09:00 的診所排在 11:00 的藥局前面。",
  "visit-v1": "AI 整理不代表內容都正確。客戶沒說要下單，意向就留空。",
  "ask-v1": "答案要能對到出處。文件沒說的，到頻道請主管確認後再答覆客戶。",
}

export function LearningLessonPage() {
  const { lessonId = "" } = useParams()
  const userId = useAuth()?.user.id
  return <LessonContent key={`${userId}:${lessonId}`} lessonId={lessonId} />
}

function LessonContent({ lessonId }: { lessonId: string }) {
  const [course, setCourse] = useState<Course | null>(null)
  const [answer, setAnswer] = useState<LessonAnswer>(() =>
    initialAnswer(lessonId)
  )
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [saving, setSaving] = useState(false)
  const [passed, setPassed] = useState(false)
  const [replay, setReplay] = useState(false)
  const submitting = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCourse(controller.signal)
      .then((data) => {
        setCourse(data)
        setReplay(data.completed.includes(lessonId))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadingError(
            error instanceof ApiError
              ? error.message
              : "課程載入失敗，請再試一次。"
          )
      })
    return () => controller.abort()
  }, [attempt, lessonId])

  useEffect(() => {
    if (passed) resultRef.current?.focus()
  }, [passed])

  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    setFeedback(null)
    try {
      const updated = await completeLesson(lessonId, answer)
      setCourse(updated)
      setPassed(true)
      celebrateCompletion(replay ? "複習完成！" : "闖關成功！")
    } catch (error) {
      setFeedback(
        error instanceof ApiError
          ? error.message
          : "進度還沒存成功，請保留這頁再試一次。"
      )
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  const lesson = course?.lessons.find((item) => item.id === lessonId)
  const index = course?.lessons.findIndex((item) => item.id === lessonId) ?? -1
  const next = course ? nextLesson(course) : null

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={lesson?.title ?? "操作練習"}
        subtitle={
          lesson
            ? `第 ${index + 1} / ${course?.lessons.length} 關 · ${lesson.minutes} 分鐘`
            : undefined
        }
        backTo="/first-week"
      />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-5 pb-10">
        {loadingError ? (
          <Notice
            text={loadingError}
            action={{
              label: "重新載入",
              onClick: () => {
                setLoadingError(null)
                setAttempt((value) => value + 1)
              },
            }}
          />
        ) : !course ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入關卡中…
          </p>
        ) : !lesson || !course.available ? (
          <Notice text="找不到這個練習關卡。" />
        ) : lessonState(course, lessonId) === "locked" ? (
          <Notice text="完成前一關，這一關就會開啟。" />
        ) : passed ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="flex flex-col items-center gap-5 rounded-3xl border-2 border-success/25 bg-success/5 p-6 text-center outline-none"
          >
            <Mascot state="yay" size={140} />
            <h2 className="flex items-center gap-2 text-xl font-semibold text-success">
              <CheckCircle2 />
              {replay ? "複習完成！" : "過關了！"}
            </h2>
            <span className="flex items-center gap-1 rounded-full bg-warning/10 px-4 py-2 text-sm font-semibold text-warning">
              <Sparkles className="size-4" />
              {replay ? "這一關的 XP 已領取" : "+20 XP"}
            </span>
            <p className="text-sm leading-relaxed">{TIPS[lessonId]}</p>
            {!next && (
              <div className="w-full rounded-2xl bg-primary/10 p-4">
                <p className="font-semibold text-primary">
                  五關完成，拜訪操作更熟練了！
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  隨時可以用打字和語音問熊熊滾。
                </p>
              </div>
            )}
            {next ? <Button asChild className="h-12 w-full text-base"><Link to={`/first-week/lessons/${next.id}`}>繼續下一關<ChevronRight /></Link></Button> : <Button className="h-12 w-full text-base" onClick={openAssistant}>問熊熊滾<ChevronRight /></Button>}
            <Link
              to="/first-week"
              className="flex min-h-11 items-center text-sm text-muted-foreground"
            >
              回課程地圖
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/10 px-4 py-3">
              <p className="text-xs font-semibold text-primary">
                操作練習 · {lesson.skill}
              </p>
              <span className="text-xs text-muted-foreground">
                {replay ? "複習關卡" : "+20 XP"}
              </span>
            </div>
            <fieldset disabled={saving} className="min-w-0">
              <Exercise
                lessonId={lessonId}
                answer={answer}
                onChange={(nextAnswer) => {
                  setAnswer(nextAnswer)
                  setFeedback(null)
                }}
              />
            </fieldset>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 self-start text-muted-foreground"
              aria-expanded={hint}
              onClick={() => setHint((value) => !value)}
            >
              <Lightbulb />
              {hint ? "收起提示" : "需要一點提示"}
            </Button>
            {hint && (
              <p className="rounded-xl bg-warning/10 p-4 text-sm leading-relaxed">
                {TIPS[lessonId]}
              </p>
            )}
            {feedback && (
              <div
                role="alert"
                className="rounded-xl bg-warning/10 p-4 text-sm leading-relaxed text-warning"
              >
                {feedback}
                <p className="mt-1 text-xs">可以直接修改，再試一次。</p>
              </div>
            )}
            <Button
              type="button"
              className="h-12 w-full text-base"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "核對並保存中…" : "檢查我的操作"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              離開後，已完成的關卡會保留。
            </p>
          </>
        )}
        {course &&
          (!lesson ||
            !course.available ||
            lessonState(course, lessonId) === "locked") && (
            <Button asChild variant="outline" className="h-12">
              <Link to="/first-week">回課程地圖</Link>
            </Button>
          )}
      </main>
    </div>
  )
}
