import type { Channel } from "@/api/channels"
import type { Role } from "@/lib/auth"
import { pickSelected, railTarget } from "@/lib/channel-rail"

type Ref = Pick<Channel, "id" | "kind" | "parent_id">

/**
 * 電腦版頻道四欄（docs/superpowers/specs/2026-10-09-desktop-layout-design.md〈頻道〉）：網址決定對話欄開哪一個、頻道列選哪一個。
 * - /channels/:id（routeId）：對話開它，頻道列選它所屬的那一塊（railTarget）。客戶討論串不在頻道清單裡，
 *   要等對話欄載入、拿到它的上層（opened）才知道；在那之前頻道列先不選。
 * - /channels（routeId 是 null）：跟手機一樣照 ?c=、記住的、預設的挑頻道列（pickSelected）；?c= 是看得到的頻道就打開它本身（文字頻道也是），不然打開頻道列選中的那一個。
 */
export function channelPanes({
  channels,
  routeId,
  requested,
  remembered,
  role,
  opened,
}: {
  channels: Channel[]
  routeId: number | null
  requested: number | null
  remembered: number | null
  role: Role
  opened: Ref | null
}): { railId: number | null; openId: number | null } {
  if (routeId !== null) {
    const known: Ref | undefined = channels.find((c) => c.id === routeId) ?? (opened?.id === routeId ? opened : undefined)
    return { railId: known ? railTarget(known) : null, openId: routeId }
  }
  const selected = pickSelected(channels, requested, remembered, role)
  const railId = selected?.id ?? null
  // ?c= 是看得到的頻道就打開它本身；不然打開頻道列選中的那一個
  const requestedIsInList = requested !== null && channels.some((c) => c.id === requested)
  const openId = requestedIsInList && selected !== null ? requested : (selected?.id ?? null)
  return { railId, openId }
}
