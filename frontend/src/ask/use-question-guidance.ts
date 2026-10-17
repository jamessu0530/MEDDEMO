import { useEffect, useState } from "react"
import type { QuestionSuggestionsInput } from "@/api/asks"
import type { Entry } from "@/ask/conversation"
import type { AssistantPage } from "@/ask/page-context"
import {
  questionGuidance,
  type QuestionGuidance,
} from "@/ask/question-guidance"
import {
  createSuggestionLoader,
  questionSuggestionInput,
} from "@/ask/suggestion-request"
import { useAuth } from "@/lib/auth"

/** 畫面或問答改變後再整理建議，不因輸入每個字而呼叫模型，也不修改草稿。 */
export function useQuestionSuggestions(
  input: QuestionSuggestionsInput | null,
  enabled = true
): string[] | undefined {
  const userId = useAuth()?.user.id
  const [loader] = useState(createSuggestionLoader)
  const [result, setResult] = useState<{
    key: string
    suggestions: string[]
  } | null>(null)
  const key = enabled && input && userId ? JSON.stringify({ userId, input }) : ""
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const context = JSON.parse(key) as { userId: string; input: QuestionSuggestionsInput }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      timeout = setTimeout(() => controller.abort(), 10_000)
      void loader
        .load(context.input, controller.signal, context.userId)
        .then((suggestions) => {
          clearTimeout(timeout)
          if (!controller.signal.aborted && suggestions.length)
            setResult({ key, suggestions })
        })
    }, 450)
    return () => {
      clearTimeout(timer)
      clearTimeout(timeout)
      controller.abort()
    }
  }, [key, loader])
  return key && result?.key === key ? result.suggestions : undefined
}

export function useQuestionGuidance(
  page: AssistantPage,
  entries: Entry[],
  busy: boolean,
  active: boolean
): QuestionGuidance {
  const fallback = questionGuidance(page, entries, busy)
  const input = questionSuggestionInput(page, entries, [
    ...fallback.suggestions,
    ...page.suggestions,
    ...page.followUps,
  ])
  const suggestions = useQuestionSuggestions(input, active && !busy)
  if (!suggestions) return fallback
  const latest = entries.at(-1)
  return {
    ...fallback,
    hint: input?.earlier.length
      ? "建議已參考目前畫面與最近對話，可帶入後再修改。"
      : page.hint,
    suggestions,
    ...(latest &&
    latest.kind !== "user" &&
    latest.page?.path === page.path &&
    !(latest.kind === "model" && latest.demo)
      ? { replyId: latest.id }
      : {}),
  }
}
