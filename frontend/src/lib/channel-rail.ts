import type { Channel } from "@/api/channels"
import type { Role } from "@/lib/auth"
import { initials } from "@/lib/presence"

// 左欄的一格：一個頻道、一個收著好幾個頻道的資料夾（地點、已封存），或區與區之間的分隔線
export type RailItem =
  | { type: "channel"; channel: Channel; unread: number }
  | { type: "folder"; key: string; label: string; icon: "places" | "archived"; channels: Channel[]; unread: number }
  | { type: "divider"; key: string }

// 上次選了哪個頻道，下次打開頻道頁還停在那裡（只是方便，讀寫失敗就退回預設）
const STORAGE_KEY = "meddemo:channel-rail"

/** 左欄方塊上的兩個字：小組取主管名字的縮寫（跟頭像一樣），地點取「・」後面那段、去掉結尾的區市縣，全國與整區照名稱 */
export function shortName(channel: Channel): string {
  if (channel.kind === "team") return initials(channel.name.replace(/小組$/, ""))
  if (channel.kind === "place") {
    const part = channel.name.split("・").at(-1) ?? channel.name
    const trimmed = part.replace(/[區市縣]$/, "")
    return Array.from(trimmed.length >= 2 ? trimmed : part).slice(0, 2).join("")
  }
  return Array.from(channel.name).slice(0, 2).join("")
}

/** 某個全國或整區頻道底下的文字頻道。後端已經排好：沒封存的照開的先後在前，封存的在後 */
export function topicsOf(channels: Channel[], parentId: number): Channel[] {
  return channels.filter((c) => c.kind === "topic" && c.parent_id === parentId)
}

/** 左欄方塊右下角的數字：自己的未讀，加上底下沒封存的文字頻道 */
export function railUnread(channels: Channel[], channel: Channel): number {
  return topicsOf(channels, channel.id)
    .filter((topic) => !topic.archived)
    .reduce((sum, topic) => sum + topic.unread, channel.unread)
}

function folder(key: string, label: string, icon: "places" | "archived", channels: Channel[]): RailItem {
  return { type: "folder", key, label, icon, channels, unread: channels.reduce((sum, c) => sum + c.unread, 0) }
}

/** 左欄：全國 → 每一區（整區、小組、地點資料夾）→ 已封存資料夾（只有 IT 會有）。
 * 文字頻道與客戶討論串在右欄，不在這裡。後端已經排好順序，這裡只分組 */
export function railItems(channels: Channel[]): RailItem[] {
  const items: RailItem[] = []
  const add = (channel: Channel) => items.push({ type: "channel", channel, unread: railUnread(channels, channel) })
  const national = channels.find((c) => c.kind === "national")
  if (national) add(national)
  for (const region of channels.filter((c) => c.kind === "region")) {
    items.push({ type: "divider", key: `divider-${region.id}` })
    add(region)
    const inRegion = channels.filter((c) => c.region_id === region.region_id && !c.archived)
    for (const team of inRegion.filter((c) => c.kind === "team")) add(team)
    const places = inRegion.filter((c) => c.kind === "place")
    if (places.length) items.push(folder(`places-${region.id}`, "地點", "places", places))
  }
  const archived = channels.filter((c) => c.kind === "team" && c.archived)
  if (archived.length) items.push({ type: "divider", key: "divider-archived" }, folder("archived", "已封存", "archived", archived))
  return items
}

/** 選中哪個頻道：網址的 ?c=，再來是上次選的；指定的是文字頻道就停在它的上層。
 * 都不在了（封存、調區）：業務與主管停在自己的小組，IT 停在全國 */
export function pickSelected(channels: Channel[], requested: number | null, remembered: number | null, role: Role): Channel | null {
  const inRail = channels.filter((c) => c.kind !== "topic" && c.kind !== "customer")
  const resolve = (id: number | null) => {
    const found = id === null ? undefined : channels.find((c) => c.id === id)
    const target = found?.kind === "topic" ? found.parent_id : found?.id
    return inRail.find((c) => c.id === target)
  }
  const national = inRail.find((c) => c.kind === "national")
  const team = inRail.find((c) => c.kind === "team" && !c.archived)
  const fallback = role === "it" ? national : (team ?? national)
  return resolve(requested) ?? resolve(remembered) ?? fallback ?? inRail[0] ?? null
}

/** 從對話頁回到兩欄時停在哪個頻道：文字頻道與客戶討論串回上層，其他回自己 */
export function railPath(channel: Pick<Channel, "id" | "kind" | "parent_id">): string {
  const up = (channel.kind === "topic" || channel.kind === "customer") && channel.parent_id !== null
  return `/channels?c=${up ? channel.parent_id : channel.id}`
}

export function rememberedChannel(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    // 私密瀏覽、被擋的網站資料、測試環境沒有 localStorage：當作沒選過
    return null
  }
}

export function rememberChannel(id: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(id))
  } catch {
    // 存不了就算了，下次退回預設
  }
}
