import { useEffect } from "react"
import { Hand, Loader2, Mic, PhoneOff, Volume2, VolumeX } from "lucide-react"

import type { Conversation } from "@/ask/conversation"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { voiceMascotState } from "@/lib/mascot"
import { useVoiceSession } from "@/voice/use-voice-session"

/** 交給頁面的介面：會話活著時打字也能送進同一個會話，並讓輸入框告訴閒置計時器「人還在」 */
export type VoiceSession = { sendText: (text: string) => void; noteActivity: () => void }

/**
 * 麥克風那一區。整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，
 * 而這個檔案是 lazy 載入的：只打字的人不會載到它。
 */
export default function VoiceDock({
  conversation,
  polls,
  onClose,
  onSession,
  onNotice,
}: {
  conversation: Conversation
  // 查詢輪詢的中止訊號，登出時才會中止（ask/ask-session.ts）
  polls: AbortSignal
  onClose: () => void
  onSession: (session: VoiceSession | null) => void
  onNotice: (notice: string | null) => void
}) {
  const voice = useVoiceSession(conversation, polls)
  const live = voice.status === "listening" || voice.status === "speaking"

  // 按麥克風就是表達了要講話，載完直接開始，不讓人再按一次
  useEffect(() => {
    void voice.start()
    return () => onSession(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 只有連上且能收發時才把介面交給頁面：connecting／idle 時打字不該真的送出去
  useEffect(() => {
    onSession(live ? { sendText: voice.sendText, noteActivity: voice.noteActivity } : null)
  }, [live, onSession, voice.sendText, voice.noteActivity])

  // 失敗與掛斷的說明交給頁面顯示：這個 dock 收起來時會整個卸載，訊息留在這裡會跟著不見
  useEffect(() => {
    onNotice(voice.notice)
  }, [voice.notice, onNotice])

  if (voice.status === "idle") {
    // 會話結束或連線失敗。「重新開始」就直接再連一次：先收起再按一次麥克風等於要業務按兩次才問得到下一句。
    // 原因寫在頁面的 notice 裡，這裡只放動作
    return (
      <div className="flex gap-2">
        <Button variant="outline" className="h-14 flex-1 gap-2 text-base" onClick={() => void voice.start()}>
          <Mic className="size-5" />
          重新開始
        </Button>
        <Button variant="ghost" className="h-14 shrink-0 px-4 text-base" onClick={onClose}>
          收起
        </Button>
      </div>
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
        {/* 熊熊滾的半身：AI 在講話、在查、在聽各有動作，一眼看得出現在輪到誰 */}
        <span className="relative flex size-12 items-center justify-center overflow-hidden rounded-full bg-accent">
          <Mascot state={voiceMascotState(speaking ? "speaking" : "listening", voice.pending)} size={48} bust />
        </span>
      </span>
      <p className="flex-1 text-sm font-medium" aria-live="polite">
        {label}
      </p>
      <Button
        variant="outline"
        size="icon"
        className="size-11 shrink-0"
        onClick={() => voice.setMuted(!voice.muted)}
        aria-label={voice.muted ? "取消靜音" : "靜音"}
        aria-pressed={voice.muted}
      >
        {voice.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
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
