import { useState } from "react"
import { Check, LockKeyhole, MapPin, Sparkles, Shirt } from "@/components/icons"

import { Mascot } from "@/components/mascot"
import { MascotPlay } from "@/components/mascot-play"
import { Mascot3D } from "@/components/mascot-3d"
import { AssistantAchievements } from "@/components/ask/assistant-achievements"

import { canWear, mascotOutfit, mascotPalette, type MascotCollection, type MascotEncounter, type MascotLook } from "@/lib/mascot-collection"

import "./mascot-wardrobe.css"

type Props = {
  collection: MascotCollection
  showHeading?: boolean
  onEquip: (look: MascotLook, asAvatar: boolean) => Promise<void>
  onEncounter: (eventId: string) => Promise<MascotEncounter>
}

/** 正式頁與獨立互動預覽共用的收藏、試穿、換裝介面。 */
export function MascotWardrobe({ collection, onEquip, onEncounter, showHeading = true }: Props) {
  const [look, setLook] = useState(collection.equipped)
  const [view, setView] = useState<"3d" | "flat">("3d")
  const [tab, setTab] = useState<"cities" | "colors" | "clothes">("cities")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const owned = canWear(collection, look)
  const color = mascotPalette(look.color)
  const outfit = mascotOutfit(look.outfit)
  const cities = collection.outfits.filter((item) => item.city)
  const rares = collection.colors.filter((item) => item.rarity === "shiny")
  const wearing = look.color === collection.equipped.color && look.outfit === collection.equipped.outfit

  async function save(asAvatar: boolean) {
    if (!owned || busy) return
    setBusy(true); setMessage(""); setError("")
    try {
      await onEquip(look, asAvatar)
      setMessage(asAvatar ? "頭像已換成這套熊熊滾！" : "熊熊滾換好衣服了！")
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有保存成功，請再試一次")
    } finally { setBusy(false) }
  }

  return <div className="mascot-wardrobe">
    {showHeading && <div className="wardrobe-heading"><h1>熊熊衣櫃</h1></div>}
    <div className="wardrobe-stats"><span><MapPin size={16} />縣市款 <b>{cities.filter((item) => item.owned).length} / {cities.length}</b></span><span><Sparkles size={16} />異色 <b>{rares.filter((item) => item.owned).length} / {rares.length}</b></span></div>
    <div className="wardrobe-layout">
      <section className="wardrobe-dressing" aria-label="試穿與換裝">
        <div className="wardrobe-stage-top"><span>{wearing ? "目前穿搭" : "試穿中"}</span><div className="wardrobe-view-toggle" role="group" aria-label="熊熊滾檢視方式"><button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>立體</button><button type="button" aria-pressed={view === "flat"} onClick={() => setView("flat")}>平面</button></div>{!wearing && <button type="button" onClick={() => { setLook(collection.equipped); setMessage(""); setError("") }}>還原穿搭</button>}</div>
        <div className={`wardrobe-stage color-${look.color}`}>{view === "3d" ? <Mascot3D key={`${look.color}-${look.outfit}`} look={look} onEncounter={onEncounter} /> : <MascotPlay key={`${look.color}-${look.outfit}`} state="idle" size={240} look={look} onEncounter={onEncounter} />}</div>
        <div className="wardrobe-look-name"><h2>{outfit.name === "原本的熊熊" ? color.name : `${color.name} · ${outfit.name}`}</h2><span>{owned ? <><Check size={14} />已收藏</> : <><LockKeyhole size={14} />尚未收藏</>}</span></div>
        <div className="wardrobe-actions"><button className="wardrobe-primary" type="button" disabled={!owned || busy} onClick={() => void save(collection.use_as_avatar)}>{busy ? "保存中…" : "換上這套"}</button><button type="button" disabled={!owned || busy} onClick={() => void save(true)}>設為我的頭像</button></div>
        <div className="wardrobe-avatar-row"><span className="wardrobe-avatar"><Mascot bust size={48} look={collection.equipped} /></span><b>{collection.use_as_avatar ? "目前頭像" : "頭像預覽"}</b></div>
        {!owned && <p className="wardrobe-hint">{!collection.colors.find((item) => item.id === look.color)?.owned ? "連點熊熊六下觸發分裂，有機會遇到這款異色。" : outfit.unlock}</p>}
        {message && <p className="wardrobe-feedback" role="status">{message}</p>}{error && <p className="wardrobe-error" role="alert">{error}</p>}
      </section>
      <section className="wardrobe-collection" aria-label="熊熊滾收藏">
        <div className="wardrobe-tabs" role="group" aria-label="收藏分類">
          <button type="button" aria-pressed={tab === "cities"} onClick={() => setTab("cities")}><MapPin size={16} />縣市款</button><button type="button" aria-pressed={tab === "colors"} onClick={() => setTab("colors")}><Sparkles size={16} />異色</button><button type="button" aria-pressed={tab === "clothes"} onClick={() => setTab("clothes")}><Shirt size={16} />服裝</button>
        </div>
        <div className="wardrobe-grid">
          {tab === "colors" ? collection.colors.map((item) => <button key={item.id} type="button" className={`wardrobe-item ${look.color === item.id ? "selected" : ""} ${item.owned ? "" : "locked"}`} aria-pressed={look.color === item.id} aria-label={`${item.name}，${item.owned ? "已收藏" : "尚未收藏，可以試穿"}`} onClick={() => { setLook({ ...look, color: item.id }); setMessage(""); setError("") }}><span className="wardrobe-item-status">{item.owned ? <Check size={14} /> : <LockKeyhole size={14} />}{item.rarity === "shiny" ? "異色" : "經典"}</span><Mascot look={{ color: item.id, outfit: look.outfit }} size={104} /><b>{item.name}</b></button>) : collection.outfits.filter((item) => tab === "clothes" ? !item.city : item.city).map((item) => <button key={item.id} type="button" className={`wardrobe-item ${look.outfit === item.id ? "selected" : ""} ${item.owned ? "" : "locked"}`} aria-pressed={look.outfit === item.id} aria-label={`${item.name}，${item.owned ? "已收藏" : "尚未收藏，可以試穿"}`} onClick={() => { setLook({ ...look, outfit: item.id }); setMessage(""); setError("") }}><span className="wardrobe-item-status">{item.owned ? <Check size={14} /> : <LockKeyhole size={14} />}{item.city ?? "日常"}</span><Mascot look={{ color: look.color, outfit: item.id }} size={104} /><b>{item.name}</b></button>)}
        </div>
        {tab === "colors" && <p className="wardrobe-hint">已分裂 {collection.encounters} 次 · 再 {collection.guaranteed_in} 次內遇見異色</p>}
      </section>
    </div>
    <AssistantAchievements achievements={collection.achievements} />
  </div>
}
