import type { Entry } from "@/ask/conversation"
import type { AssistantPage } from "@/ask/page-context"

export type QuestionGuidance = {
  hint: string
  suggestions: string[]
  /** 指向已完成的回覆，讓接續建議顯示在該則回覆下方。 */
  replyId?: number
}

const normalize = (text: string) => text.replace(/[\s？?！!。，,]/g, "")

function freshSuggestions(suggestions: string[], entries: Entry[]) {
  const asked = new Set(
    entries.flatMap((e) => (e.kind === "user" ? [normalize(e.text)] : []))
  )
  for (const entry of entries) {
    if (entry.kind === "tool")
      asked.add(normalize(entry.original || entry.question))
  }
  return [...new Set(suggestions)]
    .filter((text) => text.trim() && !asked.has(normalize(text)))
    .slice(0, 3)
}

/** 依目前頁面、最後一輪的狀態與主題給建議；查詢中或切頁時不沿用舊回覆。 */
export function questionGuidance(
  page: AssistantPage,
  entries: Entry[],
  busy = false
): QuestionGuidance {
  const initial = {
    hint: page.hint,
    suggestions: freshSuggestions(page.suggestions, []),
  }
  if (busy)
    return { hint: "熊熊滾正在回覆，稍後會提供接續提問建議。", suggestions: [] }
  const latest = entries.at(-1)
  if (!latest || latest.kind === "user" || latest.page?.path !== page.path)
    return initial
  if (latest.kind === "tool") {
    if (latest.error || latest.cancelled || latest.routing)
      return { hint: page.hint, suggestions: [] }
    if (latest.clarification)
      return {
        hint: "可以補充客戶名稱、品項或查詢期間，讓熊熊滾接著回答。",
        suggestions: [],
      }
    if (
      !latest.ask ||
      ["queued", "running", "failed"].includes(latest.ask.status)
    )
      return { hint: page.hint, suggestions: [] }
    if (["no_evidence", "not_converged"].includes(latest.ask.status))
      return {
        replyId: latest.id,
        hint: "可以先補齊線索，或確認目前有哪些資料可查。",
        suggestions: freshSuggestions(
          [
            "這個問題還需要補充哪些資料？",
            "請列出目前查得到的相關紀錄與出處。",
          ],
          entries
        ),
      }
    if (!latest.ask.answer?.trim()) return initial
  } else if (!latest.text.trim() || latest.demo) return initial

  const previousUser = [...entries].reverse().find((e) => e.kind === "user")
  const question =
    latest.kind === "tool"
      ? latest.original || latest.question
      : previousUser?.kind === "user"
        ? previousUser.text
        : ""
  const answer = latest.kind === "tool" ? latest.ask?.answer || "" : latest.text
  let suggestions = page.followUps
  // 操作與表單優先沿用頁面的下一步，避免被回覆中的數字或「資料」字樣誤判。
  if (!page.path.startsWith("/oa")) {
    const topic = question + "\n" + answer
    if (/退貨|效期/.test(topic))
      suggestions = [
        "這項退貨規定有哪些限制或例外？",
        "申請退貨前需要準備哪些資料？",
        "這些規定的文件出處在哪裡？",
      ]
    else if (/促銷|搭贈|買\s*\d+\s*送|實際單價/.test(topic))
      suggestions = [
        "把剛才的優惠換算成每盒實際單價。",
        "這個優惠有哪些數量或期限限制？",
        "幫我整理成可以向客戶說明的優惠摘要。",
      ]
    else if (/折扣|議價/.test(topic))
      suggestions = [
        "哪些折扣條件需要主管核准？",
        "申請優惠時需要準備哪些資料？",
        "幫我整理向客戶確認條件的問題。",
      ]
    else if (/銷售|業績|營收|進貨/.test(topic))
      suggestions = page.path.startsWith("/customers/")
        ? [
            "這家最近三個月的進貨有什麼變化？",
            "這家上次拜訪有哪些待跟進事項？",
            "幫我整理下次拜訪要問的三個問題。",
          ]
        : [
            "可以按客戶拆開比較剛才的數字嗎？",
            "和上一個相同長度的期間相比有什麼變化？",
            "這些數字的計算期間與依據是什麼？",
          ]
    else if (latest.kind === "tool" && latest.askKind === "memory")
      suggestions = [
        "可以列出相關訊息的日期與出處嗎？",
        "剛才提到的事項有哪些還沒完成？",
        "幫我整理需要接著向同事確認的問題。",
      ]
    else if (latest.kind === "tool" && latest.askKind === "knowledge")
      suggestions = [
        "可以用一個實際情境說明剛才的內容嗎？",
        "這項規定有哪些限制或例外？",
        "相關規定的文件出處在哪裡？",
      ]
  }
  return {
    replyId: latest.id,
    hint: "接著可以這樣問，也可以補充自己的問題。",
    suggestions: freshSuggestions([...suggestions, ...page.followUps], entries),
  }
}

/** Tab 只在空白或與建議開頭一致時補全，保留 Shift+Tab 與一般焦點導覽。 */
export function suggestedCompletion(
  value: string,
  suggestions: string[]
): string | null {
  if (!value) return suggestions[0] ?? null
  if (!value.trim()) return null
  return (
    suggestions.find((text) => text.startsWith(value) && text !== value) ?? null
  )
}

type CompletionKey = {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  nativeEvent: { isComposing?: boolean; keyCode?: number }
}

export function shouldAcceptSuggestion(
  event: CompletionKey,
  suggestion: string | null
) {
  return Boolean(
    suggestion &&
    event.key === "Tab" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== 229
  )
}
