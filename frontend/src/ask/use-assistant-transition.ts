import { useEffect, useRef, useState } from "react"

import { unlockAssistantAchievement } from "@/api/mascot"
import type { AssistantAchievementUnlock } from "@/lib/mascot-collection"

export const ASSISTANT_TRANSITION_MS = 3600
export type AssistantTransitionAction = "ghost" | "new"

type Transition = { id: number; userId: string; action: AssistantTransitionAction }
type Reward = { id: number; unlock?: AssistantAchievementUnlock; failed?: boolean }

/** Animation state is separate from conversation content, including in Ghost mode. */
export function useAssistantTransition(userId?: string) {
  const sequence = useRef(0)
  const [event, setEvent] = useState<Transition | null>(null)
  const [reward, setReward] = useState<Reward | null>(null)

  useEffect(() => {
    if (!event || event.userId !== userId) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setEvent((current) => current?.id === event.id ? null : current)
    }, ASSISTANT_TRANSITION_MS)
    void unlockAssistantAchievement(event.action, controller.signal).then((unlock) => {
      if (controller.signal.aborted) return
      setReward({ id: event.id, unlock })
      if (unlock.newly_unlocked) window.dispatchEvent(new Event("mascot-achievement-unlocked"))
    }).catch(() => {
      if (!controller.signal.aborted) setReward({ id: event.id, failed: true })
    })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [event, userId])

  return {
    event: event?.userId === userId ? event : null,
    reward: reward?.id === event?.id ? reward : null,
    play(action: AssistantTransitionAction) {
      if (userId) setEvent({ id: ++sequence.current, userId, action })
    },
  }
}
