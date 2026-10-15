import { jsonBody, request } from "@/api/client"
import type { MascotCollection, MascotEncounter, MascotLook } from "@/lib/mascot-collection"

export function getMascotCollection(signal?: AbortSignal) {
  return request<MascotCollection>("/api/mascot", { signal })
}
export function equipMascot(look: MascotLook, useAsAvatar: boolean) {
  return request<MascotCollection>("/api/mascot/equip", jsonBody("PUT", { ...look, use_as_avatar: useAsAvatar }))
}
export function encounterMascot(eventId: string) {
  return request<MascotEncounter>("/api/mascot/encounters", jsonBody("POST", { event_id: eventId }))
}
