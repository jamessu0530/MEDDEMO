import { useState } from "react"
import { createRoot } from "react-dom/client"

import { MascotWardrobe } from "@/components/mascot-wardrobe"
import { canWear, DEFAULT_MASCOT_LOOK, MASCOT_COLORS, MASCOT_OUTFITS, type MascotCollection } from "@/lib/mascot-collection"

const KEY = "meddemo:mascot-wardrobe-preview:v1"
function initial(): MascotCollection {
  try {
    const saved: MascotCollection | null = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (saved?.colors && saved?.outfits) return {
      ...saved,
      outfits: MASCOT_OUTFITS.map((item) => {
        const previous = saved.outfits.find((outfit) => outfit.id === item.id)
        return { ...item, owned: !item.city || Boolean(previous?.owned), unlocked_at: previous?.unlocked_at ?? null }
      }),
    }
  } catch { /* 存壞的示範紀錄重新開始 */ }
  return { colors: MASCOT_COLORS.map((item) => ({ ...item, owned: item.id === "classic", unlocked_at: null })), outfits: MASCOT_OUTFITS.map((item) => ({ ...item, owned: !item.city, unlocked_at: null })), equipped: DEFAULT_MASCOT_LOOK, use_as_avatar: false, encounters: 0, shiny_odds: 8, guaranteed_in: 8 }
}

export function Preview() {
  const [collection, setCollection] = useState(initial)
  function save(next: MascotCollection) {
    setCollection(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 無痕模式仍可試玩 */ }
  }
  return <>
    <MascotWardrobe collection={collection} onEquip={async (look, avatar) => {
      if (!canWear(collection, look)) throw new Error("這款還沒收藏")
      save({ ...collection, equipped: look, use_as_avatar: avatar })
    }} onEncounter={async () => {
      const shiny = collection.guaranteed_in <= 1 || crypto.getRandomValues(new Uint32Array(1))[0] % 8 === 0
      const choices = MASCOT_COLORS.filter((item) => item.rarity === "shiny")
      const color = shiny ? choices[crypto.getRandomValues(new Uint32Array(1))[0] % choices.length].id : "classic"
      const added = !collection.colors.find((item) => item.id === color)?.owned
      const next = { ...collection, encounters: collection.encounters + 1, guaranteed_in: shiny ? 8 : collection.guaranteed_in - 1, colors: collection.colors.map((item) => item.id === color ? { ...item, owned: true, unlocked_at: item.unlocked_at ?? new Date().toISOString() } : item) }
      save(next)
      return { color_id: color, newly_collected: added, collection: next }
    }} />
  </>
}
createRoot(document.getElementById("app")!).render(<Preview />)
