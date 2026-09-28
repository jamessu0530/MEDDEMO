import type { Channel, ChannelMessage } from "@/api/channels"

// 後端一次給幾則；往上捲拿到比這個少，就是到頂了
export const MESSAGE_PAGE = 50

export type ChannelSection = { key: string; title: string; channels: Channel[]; places: Channel[] }

/** 頻道列表的分段：全國一段；每一區一段，整區與小組在上面，地點另外放（畫面上收合）；封存的最後。
 * 後端已經排好順序，這裡只分組 */
export function groupChannels(channels: Channel[]): ChannelSection[] {
  const sections: ChannelSection[] = []
  const national = channels.filter((c) => c.kind === "national")
  if (national.length) sections.push({ key: "national", title: "全國", channels: national, places: [] })
  for (const region of channels.filter((c) => c.kind === "region")) {
    const inRegion = channels.filter((c) => c.region_id === region.region_id && !c.archived)
    sections.push({
      key: region.region_id ?? String(region.id),
      title: region.name,
      channels: [region, ...inRegion.filter((c) => c.kind === "team")],
      places: sortUnreadFirst(inRegion.filter((c) => c.kind === "place")),
    })
  }
  const archived = channels.filter((c) => c.archived)
  if (archived.length) sections.push({ key: "archived", title: "已封存", channels: archived, places: [] })
  return sections
}

/** 有未讀的排前面，其餘照原本的順序（sort 是穩定排序） */
export function sortUnreadFirst(channels: Channel[]) {
  return [...channels].sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0))
}

/** 新拿到的訊息併進畫面上的：同一則只留一份（自己剛送出的，下一輪輪詢又會拿到），照編號由舊到新 */
export function mergeMessages(current: ChannelMessage[], incoming: ChannelMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
