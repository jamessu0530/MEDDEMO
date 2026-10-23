import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { askSessionFor } from "@/ask/ask-session"
import { assistantVoice, closeAssistantVoice } from "@/ask/assistant-voice"
import { useCurrentPageContext } from "@/ask/use-page-context"
import { useAssistantLayout } from "@/ask/use-assistant-layout"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { FIXED_COLUMN } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

const loadVoiceDock = () => import("@/components/ask/voice-dock")

/** A voice call stays connected when a completed task opens its order. */
export function AssistantVoiceHost() {
  const user = useAuth()?.user
  const page = useCurrentPageContext()
  const asking = askSessionFor(user?.id ?? "")
  const thread = useSyncExternalStore(asking.threads.subscribe, asking.threads.getSnapshot, asking.threads.getSnapshot)
  const voice = useSyncExternalStore(assistantVoice.subscribe, assistantVoice.getSnapshot, assistantVoice.getSnapshot)
  const { inset, availableHeight } = useAssistantLayout(Boolean(user) && (voice.active || Boolean(voice.notice)),
    "[data-page-assistant], [data-route-ask], [data-page-footer]")
  const owner = `${user?.id}:${thread.id}`
  const previousOwner = useRef(owner)
  useEffect(() => {
    if (previousOwner.current !== owner) closeAssistantVoice()
    previousOwner.current = owner
  }, [owner])
  const [VoiceDock, setVoiceDock] = useState(() => lazy(loadVoiceDock))
  if (!user || (!voice.active && !voice.notice)) return null
  const failVoice = () => {
    closeAssistantVoice()
    assistantVoice.setNotice("語音載入失敗，請重新整理後再試。")
    setVoiceDock(() => lazy(loadVoiceDock))
  }
  return (
    <section
      aria-label="熊熊滾語音問答"
      className={cn(FIXED_COLUMN, "z-40 overflow-y-auto px-2.5 lg:max-w-xl")}
      style={{ bottom: inset + 8, maxHeight: availableHeight === undefined ? undefined : Math.max(0, availableHeight - 16) }}
    >
      <div className="space-y-2 rounded-2xl border-2 bg-card p-3 shadow-lg">
        <p className="text-sm font-semibold">熊熊滾 · 語音問答</p>
        {voice.notice && <Notice text={voice.notice} />}
        {voice.active ? (
          <VoiceBoundary key={owner} onFail={failVoice}>
            <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">載入語音中…</p>}>
              <VoiceDock
                conversation={thread.conversation}
                polls={asking.polls}
                page={page}
                onClose={closeAssistantVoice}
                onSession={assistantVoice.setSession}
                onNotice={assistantVoice.setNotice}
              />
            </Suspense>
          </VoiceBoundary>
        ) : <Button variant="ghost" onClick={closeAssistantVoice}>收起</Button>}
      </div>
    </section>
  )
}

class VoiceBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFail() }
  render() { return this.state.failed ? null : this.props.children }
}
