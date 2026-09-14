/**
 * 錄音時即時顯示文字（FR-4.2）：把麥克風的聲音同時送給 Gemini 的即時轉錄模型。
 * 只是顯示給業務看；拜訪紀錄的逐字稿還是錄完整段上傳後，由語音辨識產生。
 * 錄音頁用 import() 載入這支程式，Gemini SDK 不會算進首頁的下載量。
 */

import { GoogleGenAI, type LiveConnectConfig, type Session } from "@google/genai"

import { startTranscriptionSession } from "@/api/transcription"
import { INPUT_MIME_TYPE, startCapture, toBase64 } from "@/voice/audio"
import { tidyTranscript } from "@/voice/transcript"

export type LiveTranscription = { stop: () => void }

/**
 * 開始即時轉錄。onText 收到兩段文字：已經確定的部分，和還在聽的這一句（會一直改）。
 * 拿不到金鑰或連不上就回傳 null，錄音照常進行，只是沒有即時文字。
 */
export async function startLiveTranscription(
  context: AudioContext,
  stream: MediaStream,
  customerId: string,
  onText: (confirmed: string, interim: string) => void
): Promise<LiveTranscription | null> {
  let session: Session | null = null
  let stopCapture: (() => void) | null = null
  let closed = false
  let confirmed = ""
  try {
    const live = await startTranscriptionSession(customerId)
    const ai = new GoogleGenAI({ apiKey: live.token, httpOptions: { apiVersion: live.api_version } })
    session = await ai.live.connect({
      model: live.model,
      config: live.config as LiveConnectConfig,
      callbacks: {
        onmessage: (message) => {
          const content = message.serverContent
          if (content?.inputTranscription?.text) {
            confirmed = tidyTranscript(confirmed + content.inputTranscription.text)
            onText(confirmed, "")
          } else if (content?.interimInputTranscription?.text) {
            onText(confirmed, tidyTranscript(content.interimInputTranscription.text))
          }
        },
        onclose: () => {
          closed = true
        },
      },
    })
    const connected = session
    stopCapture = await startCapture(context, stream, (pcm) => {
      if (!closed) connected.sendRealtimeInput({ audio: { data: toBase64(pcm), mimeType: INPUT_MIME_TYPE } })
    })
  } catch {
    stopCapture?.()
    session?.close()
    return null
  }
  const connected = session
  return {
    stop() {
      stopCapture?.()
      if (!closed) {
        connected.sendRealtimeInput({ audioStreamEnd: true })
        connected.close()
      }
    },
  }
}
