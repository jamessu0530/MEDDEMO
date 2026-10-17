import { suggestQuestions, type QuestionSuggestionsInput } from "@/api/asks"
import {
  pageSnapshot,
  recentConversationTurns,
} from "@/ask/conversation-context"
import type { Entry } from "@/ask/conversation"
import type { AssistantPage } from "@/ask/page-context"

export function questionSuggestionInput(
  page: AssistantPage,
  entries: Entry[],
  candidates: string[]
): QuestionSuggestionsInput | null {
  const latest = entries.at(-1)
  if (latest?.kind === "user") return null
  if (
    latest?.page?.path === page.path &&
    latest.kind === "tool" &&
    (latest.error ||
      latest.cancelled ||
      latest.routing ||
      (!latest.clarification &&
        (!latest.ask ||
          ["queued", "running", "failed"].includes(latest.ask.status))))
  )
    return null
  return {
    page: pageSnapshot(page),
    earlier: recentConversationTurns(entries),
    candidates: [...new Set(candidates)]
      .filter((text) => text.trim() && text.length <= 500)
      .slice(0, 8),
  }
}

/** 只存於目前輸入元件，換帳號時隨元件卸載；遲到或中止的回覆不進快取。 */
export function createSuggestionLoader(fetchSuggestions = suggestQuestions) {
  const cache = new Map<string, string[]>()
  let owner = ""
  return {
    async load(
      input: QuestionSuggestionsInput,
      signal: AbortSignal,
      userId = ""
    ): Promise<string[]> {
      if (owner !== userId) {
        cache.clear()
        owner = userId
      }
      const key = JSON.stringify(input)
      if (signal.aborted) return []
      const cached = cache.get(key)
      if (cached) return cached
      try {
        const result = await fetchSuggestions(input, signal)
        if (signal.aborted || owner !== userId || !Array.isArray(result.suggestions)) return []
        const normalize = (text: string) => text.replace(/[\s？?！!。，,]/g, "")
        const seen = new Set(
          input.earlier.map((turn) => normalize(turn.question))
        )
        const suggestions = result.suggestions
          .flatMap((value) => {
            if (typeof value !== "string") return []
            const text = value.trim(),
              normalized = normalize(text)
            if (!normalized || text.length > 120 || seen.has(normalized))
              return []
            seen.add(normalized)
            return [text]
          })
          .slice(0, 3)
        if (suggestions.length) {
          cache.set(key, suggestions)
          if (cache.size > 20) cache.delete(cache.keys().next().value!)
        }
        return suggestions
      } catch {
        return []
      }
    },
  }
}
