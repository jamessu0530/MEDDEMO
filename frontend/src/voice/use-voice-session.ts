import { useEffect, useState, useSyncExternalStore } from "react"

import { VoiceController } from "@/voice/voice-controller"

/** 語音問答頁用的連線狀態；離開頁面時自動掛斷、關掉麥克風 */
export function useVoiceSession() {
  const [controller] = useState(() => new VoiceController())
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
    replaceAsk: controller.replaceAsk,
  }
}
