import { useEffect, useState, useSyncExternalStore } from "react"

import type { Conversation } from "@/ask/conversation"
import { VoiceController } from "@/voice/voice-controller"

/** 語音連線狀態；對話內容在傳進來的 store 裡。離開頁面時自動掛斷、關掉麥克風 */
export function useVoiceSession(conversation: Conversation) {
  const [controller] = useState(() => new VoiceController(conversation))
  const view = useSyncExternalStore(controller.subscribe, controller.getView)
  useEffect(() => {
    controller.attach()
    return controller.detach
  }, [controller])
  return {
    ...view,
    start: controller.start,
    stop: controller.stop,
    interrupt: controller.interrupt,
  }
}
