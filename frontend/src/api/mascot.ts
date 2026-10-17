import { jsonBody, request } from "@/api/client"
import type { AssistantAchievementUnlock, MascotCollection, MascotEncounter, MascotLook } from "@/lib/mascot-collection"

export function getMascotCollection(signal?: AbortSignal) {
  return request<MascotCollection>("/api/mascot", { signal })
}
export function equipMascot(look: MascotLook, useAsAvatar: boolean) {
  return request<MascotCollection>("/api/mascot/equip", jsonBody("PUT", { ...look, use_as_avatar: useAsAvatar }))
}
export function encounterMascot(eventId: string) {
  return request<MascotEncounter>("/api/mascot/encounters", jsonBody("POST", { event_id: eventId }))
}

export function unlockAssistantAchievement(action: "ghost" | "new", signal?: AbortSignal) {
  return request<AssistantAchievementUnlock>("/api/mascot/achievements", {
    ...jsonBody("POST", { action }), signal,
  })
}
