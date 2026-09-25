/**
 * 送出一次查詢並輪詢到有結果，把每一次更新寫回對話。
 * 打字問答與語音的工具呼叫走的是同一件事，所以共用這一段。
 */

import { createAsk, getAsk, isFinished, type Ask, type AskKind } from "@/api/asks"
import type { Conversation } from "@/ask/conversation"

// 還沒答完的提問每半秒問一次進度，查到第幾輪會即時出現在畫面上。
// 用 500ms 而不是打字問答原本的 1000ms：語音那條路的輪詢間隔會直接加在業務的等待時間上
// （voice-controller.ts 原本的註解），統一到較慢的一邊等於讓語音變慢
const POLL_MS = 500

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

/** 回傳查完的 Ask；中途被 abort 會丟出，呼叫端自行忽略 */
export async function runAsk(
  conversation: Conversation,
  entryId: number,
  kind: AskKind,
  question: string,
  signal: AbortSignal
): Promise<Ask> {
  let ask = await createAsk(kind, question)
  conversation.replace(entryId, { ask })
  while (!isFinished(ask)) {
    await sleep(POLL_MS, signal)
    try {
      ask = await getAsk(ask.id, signal)
    } catch (error) {
      if (signal.aborted) throw error
      continue // 網路一時不通就等下一輪
    }
    conversation.replace(entryId, { ask })
  }
  return ask
}
