/**
 * 送出一次查詢並輪詢到有結果，把每一次更新寫回對話。
 * 打字問答與語音的工具呼叫走的是同一件事，所以共用這一段。
 */

import { createAsk, getAsk, isFinished, type Ask, type AskKind } from "@/api/asks"
import { ApiError } from "@/api/client"
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

/** 回傳查完的 Ask；中途被 abort、或後端明確說不行（4xx）會丟出，呼叫端決定怎麼顯示。
 * file：打字提問附的檔案；utteranceId：那句提問，送出後把後端回的附件（簽過名的網址）掛上去顯示縮圖 */
export async function runAsk(
  conversation: Conversation,
  entryId: number,
  kind: AskKind,
  question: string,
  signal: AbortSignal,
  options: { file?: File; utteranceId?: number } = {}
): Promise<Ask> {
  let ask = await createAsk(kind, question, options.file)
  if (options.utteranceId !== undefined && ask.attachment) conversation.attach(options.utteranceId, ask.attachment)
  conversation.replace(entryId, { ask })
  while (!isFinished(ask)) {
    await sleep(POLL_MS, signal)
    try {
      ask = await getAsk(ask.id, signal)
    } catch (error) {
      // 4xx 是後端明確說不行（提問不存在、登入失效）：再問幾次答案都一樣。
      // 輪詢不跟著問答頁卸載而停（ask/ask-session.ts），這種情況不自己停就會每半秒問到關掉網頁為止
      if (signal.aborted || (error instanceof ApiError && error.status < 500)) throw error
      continue // 網路一時不通、後端暫時出錯就等下一輪
    }
    conversation.replace(entryId, { ask })
  }
  return ask
}
