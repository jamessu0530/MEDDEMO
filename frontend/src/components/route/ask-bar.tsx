import { useEffect, useRef, useState, type FormEvent } from "react"
import { Mic, SendHorizontal, Square } from "lucide-react"

import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type AskBarProps = {
  // 等熊熊滾的時候：輸入列換成熊熊滾在想
  busy: boolean
  // 問的時候出錯（熊熊滾沒設定、用量上限、連不上）
  error: string | null
  // 回 true（拿到對照卡）才清空輸入框
  onAsk: (question: string) => Promise<boolean>
  className?: string
}

/**
 * 跟熊熊滾說要怎麼排的輸入列（首頁與調整清單的底部）。右邊麥克風用錄拜訪的即時轉文字（voice/live-transcription.ts），
 * 講完再按一次，文字留在輸入框裡，業務看過再按送出。只有業務看得到。
 */
export function AskBar({ busy, error, onAsk, className }: AskBarProps) {
  const [text, setText] = useState("")
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  // 離開頁面時一定要關掉麥克風
  useEffect(() => () => stopRef.current?.(), [])

  async function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("瀏覽器不允許這個網址錄音，請改用打字。")
      return
    }
    setMicError(null)
    // iOS 只允許在使用者點擊的當下開啟聲音處理：AudioContext 要在點擊後立刻建立
    const context = new AudioContext()
    void context.resume()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (reason) {
      void context.close()
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError"
      setMicError(denied ? "沒有麥克風權限，請到瀏覽器設定允許，或改用打字。" : "麥克風開不起來，請改用打字。")
      return
    }
    let handle: { stop: () => void } | null = null
    let stopped = false
    const stop = () => {
      stopped = true
      handle?.stop()
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      stopRef.current = null
      setListening(false)
    }
    stopRef.current = stop
    setListening(true)
    const before = text.trim() ? `${text.trim()} ` : ""
    const { startLiveTranscription } = await import("@/voice/live-transcription")
    handle = await startLiveTranscription(context, stream, null, (confirmed, interim) => setText(before + confirmed + interim))
    if (stopped) {
      handle?.stop() // 連上之前就按了停
      return
    }
    if (!handle) {
      stop()
      setMicError("語音轉文字現在不能用，請改用打字。")
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const question = text.trim()
    if (!question || busy) return
    stopRef.current?.()
    if (await onAsk(question)) setText("")
  }

  const shown = error ?? micError
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-1", className)}>
      {busy ? (
        <div className="flex h-12 items-center gap-2 rounded-2xl border-2 bg-card px-3 shadow-lip" role="status">
          <Mascot state="think" size={40} bust />
          <span className="text-sm text-muted-foreground">熊熊滾想一下…</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
            placeholder="跟熊熊滾說要怎麼排…"
            aria-label="跟熊熊滾說要怎麼排"
            className="h-12 bg-card"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("size-12 shrink-0", listening && "text-destructive")}
            aria-label={listening ? "講完了" : "用說的"}
            aria-pressed={listening}
            onClick={() => (listening ? stopRef.current?.() : void startListening())}
          >
            {listening ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
          </Button>
          <Button type="submit" size="icon" className="size-12 shrink-0" disabled={!text.trim() || listening} aria-label="送出">
            <SendHorizontal className="size-5" />
          </Button>
        </div>
      )}
      {listening && <p className="px-1 text-xs text-primary">聽你說…講完再按一次麥克風</p>}
      {shown && <p className="px-1 text-xs text-destructive">{shown}</p>}
    </form>
  )
}
