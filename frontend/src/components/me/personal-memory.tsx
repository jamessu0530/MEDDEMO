import { askSessionFor } from "@/ask/ask-session"
import { openAssistant } from "@/ask/assistant-window"
import { useConversation } from "@/ask/use-conversation"
import { AskMemoryMap } from "@/components/ask/memory-map"
import { useAuth } from "@/lib/auth"

/** 個人的記憶地圖彙整同一登入帳號的跨頁對話。 */
export function PersonalMemory({ compact = false }: { compact?: boolean }) {
  const user = useAuth()?.user
  const asking = askSessionFor(user?.id ?? "")
  const entries = useConversation(asking.conversation).filter(
    (entry) => entry.kind === "tool" || entry.text.trim()
  )
  return (
    <section aria-label="我的記憶地圖">
      {!compact && <h2 className="text-base font-semibold">我的記憶</h2>}
      <AskMemoryMap
        compact={compact}
        entries={entries}
        edits={asking.mapEdits}
        onJump={(id) => {
          openAssistant()
          requestAnimationFrame(() => {
            const element = document.getElementById(`ask-entry-${id}`)
            element?.scrollIntoView({ behavior: "smooth", block: "nearest" })
            element?.focus({ preventScroll: true })
          })
        }}
      />
    </section>
  )
}
