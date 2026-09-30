import { useEffect, useState, useSyncExternalStore } from "react"

import type { Conversation } from "@/ask/conversation"
import { VoiceController } from "@/voice/voice-controller"

/**
 * 語音連線狀態；對話內容在傳進來的 store 裡。離開頁面時自動掛斷、關掉麥克風，
 * 但模型已經叫去查的那幾題照樣查完，回到問答頁看得到結果。
 */
export function useVoiceSession(conversation: Conversation, polls: AbortSignal) {
  const [controller] = useState(() => new VoiceController(conversation, polls))
  const view = useSyncExternalStore(controller.subscribe, controller.getView)
  useEffect(() => controller.stop, [controller])
  return {
    ...view,
    start: controller.start,
    stop: controller.stop,
    interrupt: controller.interrupt,
    sendText: controller.sendText,
    noteActivity: controller.noteActivity,
    setMuted: controller.setMuted,
  }
}
