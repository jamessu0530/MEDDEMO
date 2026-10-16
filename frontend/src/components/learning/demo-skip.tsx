import { useState } from "react"

import { ApiError } from "@/api/client"
import { skipCourseForDemo, type Course } from "@/api/learning"
import { Button } from "@/components/ui/button"

export function DemoLearningSkip({
  onSkipped,
}: {
  onSkipped: (course: Course) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function skip() {
    setPending(true)
    setError(null)
    try {
      onSkipped(await skipCourseForDemo())
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.message
          : "暫時無法跳過課程，請再試一次。"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-center">
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full"
        disabled={pending}
        onClick={skip}
      >
        {pending ? "正在開啟 AI 問答…" : "Demo：跳過課程，直接使用 AI"}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        這次登入可先體驗文字與語音問答，課程進度與 XP 保留。
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
