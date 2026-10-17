import type { Turn } from "@/api/asks"
import type { Entry, Utterance } from "@/ask/conversation"
import type { AskPageContext } from "@/ask/page-context"

export function pageSnapshot(page: AskPageContext): AskPageContext {
  return {
    path: page.path.slice(0, 300),
    title: page.title.slice(0, 120),
    facts: page.facts.slice(0, 16).map((fact) => fact.slice(0, 500)),
  }
}

/** 收集真正完成的問答，包括 OA 當頁回答；工具結果與語音覆述只算同一輪。 */
export function recentConversationTurns(
  entries: Entry[],
  maxTurns = 6,
  answerChars = 1000
): Turn[] {
  const turns: Turn[] = []
  let user: Utterance | undefined
  let currentIndex: number | undefined
  let hasTool = false
  const turn = (
    question: string,
    answer: string,
    page?: AskPageContext
  ): Turn => ({
    question: question.slice(0, 500),
    answer: answer.slice(0, answerChars),
    ...(page ? { page: pageSnapshot(page) } : {}),
  })
  for (const entry of entries) {
    if (entry.kind === "user") {
      if (!entry.text.trim()) continue
      user = entry
      currentIndex = undefined
      hasTool = false
    } else if (entry.kind === "tool") {
      if (entry.routing || entry.error || entry.cancelled) continue
      const answer =
        entry.clarification ||
        (entry.ask &&
        ["answered", "no_evidence", "not_converged"].includes(entry.ask.status)
          ? entry.ask.answer
          : null)
      if (!answer?.trim()) continue
      const next = turn(
        entry.original || entry.question,
        answer,
        entry.page ?? user?.page
      )
      if (entry.clarification && entry.hasFile) next.has_file = true
      if (currentIndex !== undefined && !hasTool) turns[currentIndex] = next
      else {
        currentIndex = turns.length
        turns.push(next)
      }
      hasTool = true
    } else if (
      user?.text.trim() &&
      entry.text.trim() &&
      !entry.demo &&
      !hasTool
    ) {
      if (currentIndex === undefined) {
        currentIndex = turns.length
        turns.push(turn(user.text, entry.text, entry.page ?? user.page))
      } else {
        turns[currentIndex].answer =
          `${turns[currentIndex].answer}\n${entry.text}`.slice(0, answerChars)
      }
    }
  }
  return turns.slice(-maxTurns)
}
