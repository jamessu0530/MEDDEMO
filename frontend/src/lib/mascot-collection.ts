import catalog from "@/data/mascot-catalog.json"

export type MascotLook = { color: string; outfit: string }
export type MascotColor = (typeof catalog.colors)[number]
export type MascotOutfit = (typeof catalog.outfits)[number]
export const MASCOT_COLORS = catalog.colors
export const MASCOT_OUTFITS = catalog.outfits
export const DEFAULT_MASCOT_LOOK: MascotLook = { color: "classic", outfit: "none" }
export function mascotPalette(id = "classic") {
  return MASCOT_COLORS.find((color) => color.id === id) ?? MASCOT_COLORS[0]
}
export function mascotOutfit(id = "none") {
  return MASCOT_OUTFITS.find((outfit) => outfit.id === id) ?? MASCOT_OUTFITS[0]
}
export type Collected<T> = T & { owned: boolean; unlocked_at: string | null }
export type MascotCollection = {
  colors: Collected<MascotColor>[]
  outfits: Collected<MascotOutfit>[]
  equipped: MascotLook
  use_as_avatar: boolean
  encounters: number
  shiny_odds: number
  guaranteed_in: number
}
export type MascotEncounter = { color_id: string; newly_collected: boolean; collection: MascotCollection }
export function canWear(collection: MascotCollection, look: MascotLook) {
  return collection.colors.some((color) => color.id === look.color && color.owned) && collection.outfits.some((outfit) => outfit.id === look.outfit && outfit.owned)
}
