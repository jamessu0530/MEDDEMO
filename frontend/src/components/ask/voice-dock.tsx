import { useEffect } from "react"
import { AudioLines, Hand, Loader2, Mic, PhoneOff } from "lucide-react"

import type { Conversation } from "@/ask/conversation"
import { Button } from "@/components/ui/button"
import { useVoiceSession } from "@/voice/use-voice-session"

/**
 * 麥克風那一區。整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，
 * 而這個檔案是 lazy 載入的：只打字的人不會載到它。
 */
export default function VoiceDock({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const voice = useVoiceSession(conversation)

  // 按麥克風就是表達了要講話，載完直接開始，不讓人再按一次
  useEffect(() => {
    void voice.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (voice.status === "idle") {
    // 會話結束或連線失敗：把 dock 收掉，notice 由頁面顯示
    return (
      <Button variant="outline" className="h-14 w-full gap-2 text-base" onClick={onClose}>
        <Mic className="size-5" />
        重新開始
      </Button>
    )
  }
  if (voice.status === "connecting") {
    return (
      <Button className="h-14 w-full gap-2 text-base" disabled>
        <Loader2 className="size-5 animate-spin" />
        連線中…
      </Button>
    )
  }
  const speaking = voice.status === "speaking"
  const label = speaking ? "AI 回答中" : voice.pending > 0 ? "查詢中…" : "聆聽中，直接說"
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex size-12 shrink-0 items-center justify-center" aria-hidden>
        {/* 外圈跟著麥克風音量放大，看得出有收到聲音 */}
        <span
          className="absolute inset-0 rounded-full bg-primary/25 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(voice.level * 6, 0.7)})` }}
        />
        <span className="relative flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {speaking ? <AudioLines className="size-5" /> : <Mic className="size-5" />}
        </span>
      </span>
      <p className="flex-1 text-sm font-medium" aria-live="polite">
        {label}
      </p>
      {speaking && (
        <Button variant="outline" className="h-11 gap-1.5" onClick={voice.interrupt}>
          <Hand className="size-4" />
          打斷
        </Button>
      )}
      <Button variant="outline" className="h-11 gap-1.5 text-destructive" onClick={voice.stop}>
        <PhoneOff className="size-4" />
        結束
      </Button>
    </div>
  )
}
