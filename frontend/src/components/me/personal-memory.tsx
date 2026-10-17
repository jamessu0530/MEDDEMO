import { askSessionFor } from "@/ask/ask-session"
import { useConversation } from "@/ask/use-conversation"
import { AskMemoryMap } from "@/components/ask/memory-map"
import { AccountMemoryStatus } from "@/components/ask/memory-status"
import { useAuth } from "@/lib/auth"
import { useNavigate } from "react-router"
import { conversationPath, LEGACY_THREAD } from "@/ask/conversation-threads"

/** 個人的記憶地圖彙整同一登入帳號的跨頁對話。 */
export function PersonalMemory({ compact = false }: { compact?: boolean }) {
  const user = useAuth()?.user
  const navigate = useNavigate()
  const asking = askSessionFor(user?.id ?? "")
  const entries = useConversation(asking.threads.history).filter(
    (entry) => !entry.ghost && (entry.kind === "tool" || entry.text.trim())
  )
  return (
    <section aria-label="我的記憶地圖">
      {!compact && <h2 className="text-base font-semibold">我的記憶</h2>}
      <AskMemoryMap
        compact={compact}
        entries={entries}
        edits={asking.mapEdits}
        onJump={(id) => {
          const entry = entries.find((item) => item.id === id)
          if (!entry) return
          asking.threads.resume(entry.threadId ?? LEGACY_THREAD)
          navigate(conversationPath(entry.page), { state: { assistantThread: entry.threadId ?? LEGACY_THREAD, assistantEntry: id } })
        }}
      />
      <AccountMemoryStatus memory={asking.memory} />
    </section>
  )
}
