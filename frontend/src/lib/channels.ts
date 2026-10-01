import type { ChannelKind, ChannelMessage } from "@/api/channels"

// 後端一次給幾則；往上捲拿到比這個少，就是到頂了
export const MESSAGE_PAGE = 50

// 頻道種類的名稱：對話頁的副標題、右欄的頁首
export const KIND_LABEL: Record<ChannelKind, string> = {
  national: "全國頻道",
  region: "整區頻道",
  team: "小組頻道",
  place: "地點頻道",
  customer: "客戶討論串",
  topic: "文字頻道",
}

/** 新拿到的訊息併進畫面上的：同一則只留一份（自己剛送出的，下一輪輪詢又會拿到），照編號由舊到新 */
export function mergeMessages(current: ChannelMessage[], incoming: ChannelMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

// 送出 @熊熊滾 之後最多顯示「熊熊滾正在想」多久：背景工作的上限是 180 秒，過了還沒回就是不會回了
export const MASCOT_WAIT_MS = 3 * 60_000
// 叫熊熊滾的規則，跟後端 services/channels.MENTION 一樣。不用 lookbehind：iOS 16.4 以前的 Safari 不支援，整支程式會載不起來
const MENTION = /(?:^|[^0-9a-z０-９ａ-ｚ._%+-])[@＠](?:熊熊|(?:ai|ａｉ)(?![0-9a-z０-９ａ-ｚ]))/i

/** 畫面上有沒有還在等熊熊滾回答的 @：送出不到三分鐘，也還沒有熊熊滾的訊息回覆它 */
export function awaitingMascot(messages: ChannelMessage[], now: number) {
  const answered = new Set(messages.map((m) => m.reply_to_id))
  return messages.some((m) => m.mentions_ai && !answered.has(m.id) && now - Date.parse(m.created_at) < MASCOT_WAIT_MS)
}

/** 按「@熊熊滾」：還沒叫它就在開頭補上，已經叫了就不重複 */
export function withMascotMention(draft: string) {
  return MENTION.test(draft) ? draft : `@熊熊滾 ${draft}`
}
