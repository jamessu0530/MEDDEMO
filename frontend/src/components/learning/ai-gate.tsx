import { useEffect, useState, type ReactNode } from "react"
import { ChevronRight, LockKeyhole } from "@/components/icons"
import { Link } from "react-router"

import { ApiError } from "@/api/client"
import { getCourse, type Course } from "@/api/learning"
import { BottomNav } from "@/components/bottom-nav"
import { DemoLearningSkip } from "@/components/learning/demo-skip"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"

export function LearningAiGate({ children, embedded = false, active = true }: { children: ReactNode; embedded?: boolean; active?: boolean }) {
  const user = useAuth()?.user
  if (user?.role !== "sales") return children
  return <SalesGate key={user.id} embedded={embedded} active={active}>{children}</SalesGate>
}

function SalesGate({ children, embedded, active }: { children: ReactNode; embedded: boolean; active: boolean }) {
  const [course, setCourse] = useState<Course | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    getCourse(controller.signal)
      .then(setCourse)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof ApiError
              ? error.message
              : "暫時無法讀取課程進度，請再試一次。"
          )
      })
    return () => controller.abort()
  }, [attempt, active])

  if (course?.ai_unlocked) return children
  return (
    <div className={embedded ? "min-h-0 flex-1 overflow-y-auto" : "flex min-h-svh flex-col"}>
      {!embedded && <PageHeader title="AI 問答" backTo="/" />}
      <main className={embedded ? "flex flex-col items-center gap-4 px-5 py-6 text-center" : "flex flex-1 flex-col items-center gap-5 px-5 pt-10 pb-28 text-center"}>
        {error ? (
          <Notice
            text={error}
            action={{
              label: "重新載入",
              onClick: () => {
                setError(null)
                setAttempt((value) => value + 1)
              },
            }}
          />
        ) : !course ? (
          <p className="text-sm text-muted-foreground">讀取課程進度中…</p>
        ) : (
          <>
            <Mascot state="hi" size={128} />
            <span className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary">
              <LockKeyhole className="size-4" />
              完成課程就能解鎖
            </span>
            <h2 className="text-xl font-semibold">先練一趟，再問熊熊滾</h2>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              五個短關卡帶你操作客戶檔案、促銷、路線和拜訪確認，也練習核對 AI
              的答案出處。
            </p>
            <p className="text-sm font-semibold">
              已完成 {course.completed.length} / {course.lessons.length} 關 · 再{" "}
              {course.lessons.length - course.completed.length} 關就解鎖
            </p>
            <Button asChild className="h-12 w-full max-w-sm text-base">
              <Link to="/first-week">
                {course.completed.length ? "繼續我的課程" : "開始新人課程"}
                <ChevronRight />
              </Link>
            </Button>
            {course.demo_skip_available && (
              <DemoLearningSkip onSkipped={setCourse} />
            )}
          </>
        )}
      </main>
      {!embedded && <BottomNav />}
    </div>
  )
}
