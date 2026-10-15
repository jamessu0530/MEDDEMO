import { useEffect, useState } from "react"

import { encounterMascot, getMascotCollection } from "@/api/mascot"
import { MascotPlay } from "@/components/mascot-play"
import type { MascotState } from "@/lib/mascot"
import type { MascotCollection } from "@/lib/mascot-collection"

/** App 的戳戳熊：穿著已儲存的衣服，分裂抽選與收藏寫回登入帳號。 */
export function CollectedMascotPlay({ state = "idle", size = 96, className }: { state?: MascotState; size?: number; className?: string }) {
  const [collection, setCollection] = useState<MascotCollection | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getMascotCollection(controller.signal).then(setCollection).catch(() => {})
    return () => controller.abort()
  }, [])
  return <MascotPlay state={state} size={size} className={className} look={collection?.equipped} onEncounter={async (eventId) => {
    const result = await encounterMascot(eventId)
    setCollection(result.collection)
    return result
  }} />
}
