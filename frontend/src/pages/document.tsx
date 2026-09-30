import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { getDocument, type InternalDocument } from "@/api/first-week"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404，沒有這份文件，重新載入也一樣
  | { status: "error"; missing: boolean }
  | { status: "ready"; document: InternalDocument }

// 目前唯一的入口是新人第一週頁（必讀文件與每天要讀的那幾份），返回鍵就回那裡
const BACK_TO = "/first-week"

/** 讀一份內部文件：標題加各小節的原文，純文字。內容跟問答查到、引用的是同一份 */
export function DocumentPage() {
  const { sourceName = "" } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getDocument(sourceName, controller.signal)
      .then((document) => setState({ status: "ready", document }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [sourceName, attempt])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={state.status === "ready" ? state.document.title : "內部文件"}
        subtitle={state.status === "ready" ? "內部文件" : undefined}
        backTo={BACK_TO}
      />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入文件中…</p>}
        {state.status === "error" && state.missing && (
          <Notice text="找不到這份文件。" action={{ label: "回新人第一週", onClick: () => navigate(BACK_TO) }} />
        )}
        {state.status === "error" && !state.missing && (
          <Notice
            text="連不上伺服器，文件沒有載入。"
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "回新人第一週", onClick: () => navigate(BACK_TO) }}
          />
        )}
        {state.status === "ready" &&
          state.document.sections.map((section) => (
            <section key={section.section} className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold">{section.section}</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{section.content}</p>
            </section>
          ))}
      </main>
    </div>
  )
}
