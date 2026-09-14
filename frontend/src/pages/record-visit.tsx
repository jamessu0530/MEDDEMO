import { useEffect, useRef, useState } from "react"
import { CloudOff, Loader2, Mic, X } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import { cachedCustomer, getCustomer } from "@/api/customers"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatElapsed } from "@/lib/format"
import { isTemporary, uploadQueue, useUploadQueue, type QueuedRecording } from "@/lib/offline-queue"
import type { LiveTranscription } from "@/voice/live-transcription"

type Phase =
  | { name: "idle" }
  | { name: "recording"; startedAt: number }
  | { name: "uploading" }
  | { name: "saved"; offline: boolean } // 錄音存在手機，恢復連線自動送出（FR-4.3）
  | { name: "error"; message: string; canResend: boolean }

type LiveState = { status: "connecting" | "on" | "unavailable" | "offline"; confirmed: string; interim: string }

// iOS Safari 只錄得出 mp4，Chrome／Android 是 webm，挑瀏覽器支援的第一個
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
// 即時轉錄框只顯示最後這麼多字，長一點的口述不會把按鈕擠出畫面
const LIVE_TEXT_CHARS = 90

function pickMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a"
  if (mimeType.includes("ogg")) return "ogg"
  return "webm"
}

export function RecordVisit() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: "idle" })
  const [elapsed, setElapsed] = useState(0)
  const [askCancel, setAskCancel] = useState(false)
  const [live, setLive] = useState<LiveState>({ status: "connecting", confirmed: "", interim: "" })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingRef = useRef<QueuedRecording | null>(null)
  const savedRef = useRef(false)
  const discardRef = useRef(false)
  const customerNameRef = useRef<string | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const liveRef = useRef<LiveTranscription | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCustomer(customerId, controller.signal)
      .then((customer) => {
        customerNameRef.current = customer.name
        setCustomerName(customer.name)
      })
      .catch(() => {
        // 沒網路時用手機裡記著的客戶清單，待送出的錄音才看得出是哪一家
        const cached = cachedCustomer(customerId)
        if (!cached || controller.signal.aborted) return
        customerNameRef.current = cached.name
        setCustomerName(cached.name)
      })
    return () => controller.abort()
  }, [customerId])

  useEffect(() => {
    if (phase.name !== "recording") return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)), 250)
    return () => clearInterval(timer)
  }, [phase])

  function stopLive() {
    liveRef.current?.stop()
    liveRef.current = null
    void contextRef.current?.close()
    contextRef.current = null
  }

  // 離開頁面時一定要關掉麥克風與即時轉錄，錄到一半離開就當作放棄
  useEffect(
    () => () => {
      discardRef.current = true
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
      stopLive()
    },
    []
  )

  async function send(recording: QueuedRecording) {
    setPhase({ name: "uploading" })
    if (!navigator.onLine && savedRef.current) {
      setPhase({ name: "saved", offline: true })
      return
    }
    try {
      const visit = await uploadQueue.sendNow(recording)
      navigate(`/visits/${visit.id}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : "上傳失敗"
      if (isTemporary(error) && savedRef.current) {
        setPhase({ name: "saved", offline: !navigator.onLine })
        return
      }
      // 重送也不會成功的錯誤（例如檔案太大），不留在手機裡
      if (!isTemporary(error)) void uploadQueue.remove(recording.clientRef)
      setPhase({
        name: "error",
        message: isTemporary(error) ? `錄音還在手機上，沒有上傳成功：${message}` : `上傳失敗：${message}`,
        canResend: isTemporary(error),
      })
    }
  }

  async function startLive(context: AudioContext, stream: MediaStream, recorder: MediaRecorder) {
    if (!navigator.onLine) {
      setLive({ status: "offline", confirmed: "", interim: "" })
      return
    }
    setLive({ status: "connecting", confirmed: "", interim: "" })
    const { startLiveTranscription } = await import("@/voice/live-transcription")
    const handle = await startLiveTranscription(context, stream, customerId, (confirmed, interim) =>
      setLive({ status: "on", confirmed, interim })
    )
    if (recorderRef.current !== recorder || recorder.state !== "recording") {
      handle?.stop() // 連上之前就已經錄完或取消
      return
    }
    liveRef.current = handle
    setLive((current) => ({ ...current, status: handle ? "on" : "unavailable" }))
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ name: "error", message: "瀏覽器不允許這個網址錄音，請改用 HTTPS 網址開啟。", canResend: false })
      return
    }
    // iOS 只允許在使用者點擊的當下開啟聲音處理：即時轉錄用的 AudioContext 要在點擊後立刻建立
    const context = new AudioContext()
    void context.resume()
    contextRef.current = context
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const startedAt = Date.now()
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        stopLive()
        if (discardRef.current) return
        const type = recorder.mimeType || mimeType || "audio/webm"
        // 錄音編號在這裡定下來；之後不管是馬上送、還是恢復連線後自動重送，伺服器都只會建一筆
        const recording: QueuedRecording = {
          clientRef: crypto.randomUUID(),
          customerId,
          customerName: customerNameRef.current ?? customerId,
          filename: `visit.${extensionFor(type)}`,
          blob: new Blob(chunksRef.current, { type }),
          recordedAt: startedAt,
          durationSeconds: Math.round((Date.now() - startedAt) / 1000),
          state: "pending",
          visitId: null,
          error: null,
        }
        recordingRef.current = recording
        // 先存進手機再上傳：沒有訊號、或上傳到一半斷線，錄音都不會掉（NFR-6）
        savedRef.current = await uploadQueue.save(recording)
        void send(recording)
      }
      recorder.start()
      recorderRef.current = recorder
      setElapsed(0)
      setPhase({ name: "recording", startedAt })
      void startLive(context, stream, recorder)
    } catch (error) {
      stopLive()
      const denied = error instanceof DOMException && error.name === "NotAllowedError"
      setPhase({
        name: "error",
        message: denied
          ? "沒有麥克風權限。請到瀏覽器設定允許這個網站使用麥克風，再試一次。"
          : "麥克風開不起來，請確認沒有其他 App 正在使用麥克風。",
        canResend: false,
      })
    }
  }

  function finish() {
    setPhase({ name: "uploading" })
    recorderRef.current?.stop()
  }

  function cancel() {
    discardRef.current = true
    recorderRef.current?.stop()
    stopLive()
    navigate(`/customers/${customerId}`)
  }

  const recording = phase.name === "recording"
  const liveText = live.confirmed + live.interim
  const shownText = liveText.length > LIVE_TEXT_CHARS ? `…${liveText.slice(-LIVE_TEXT_CHARS)}` : liveText
  const confirmedShown = shownText.slice(0, Math.max(0, shownText.length - live.interim.length))

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="口述拜訪紀錄"
        subtitle={customerName ?? undefined}
        backTo={`/customers/${customerId}`}
        leading={
          recording ? (
            <button
              type="button"
              aria-label="取消錄音"
              onClick={() => setAskCancel(true)}
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          ) : undefined
        }
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        {phase.name === "idle" && (
          <>
            <button
              type="button"
              onClick={start}
              aria-label="開始錄音"
              className="flex size-28 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95"
            >
              <Mic className="size-10" />
            </button>
            <div className="space-y-1">
              <p className="font-medium">按下開始錄音</p>
              <p className="text-sm text-muted-foreground">
                想到什麼講什麼：競品、抱怨、客戶想進的貨、答應的事、什麼時候再來。說完系統會自己整理成欄位。
              </p>
            </div>
          </>
        )}

        {recording && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
              錄音中
            </div>
            <p className="font-mono text-5xl font-semibold tabular-nums">{formatElapsed(elapsed)}</p>
            {/* FR-4.2：邊講邊看到文字。正式逐字稿還是錄完後由語音辨識產生 */}
            <div className="w-full max-w-sm rounded-2xl border bg-card px-4 py-3 text-left">
              <p className="text-[11px] tracking-wide text-muted-foreground">即時轉錄</p>
              {live.status === "offline" && (
                <p className="mt-1 text-sm text-muted-foreground">沒有網路：錄音會先存在手機，恢復連線後再整理。</p>
              )}
              {live.status === "unavailable" && (
                <p className="mt-1 text-sm text-muted-foreground">即時轉錄暫時無法使用，錄音照常進行。</p>
              )}
              {(live.status === "connecting" || live.status === "on") && (
                <p className="mt-1 min-h-12 text-sm leading-relaxed">
                  {shownText ? (
                    <>
                      {confirmedShown}
                      <span className="text-muted-foreground">{shownText.slice(confirmedShown.length)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{live.status === "connecting" ? "連線中…" : "開始講話後，文字會出現在這裡"}</span>
                  )}
                  <span className="text-muted-foreground/60">▍</span>
                </p>
              )}
            </div>
            <Button className="h-12 w-full max-w-xs text-base" onClick={finish}>
              說完了，整理成紀錄
            </Button>
          </>
        )}

        {phase.name === "uploading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            上傳錄音中…
          </div>
        )}

        {phase.name === "saved" && <SavedOnPhone offline={phase.offline} onContinue={() => navigate("/")} />}

        {phase.name === "error" && (
          <div className="w-full">
            <Notice
              text={phase.message}
              action={
                phase.canResend
                  ? {
                      label: "重新上傳",
                      onClick: () => {
                        if (recordingRef.current) void send(recordingRef.current)
                      },
                    }
                  : { label: "再試一次", onClick: () => setPhase({ name: "idle" }) }
              }
              secondary={phase.canResend ? { label: "重錄", onClick: () => setPhase({ name: "idle" }) } : undefined}
            />
          </div>
        )}
      </main>

      {/* FR-4.1：取消要二次確認，免得誤觸把整段錄音丟掉 */}
      <Dialog open={askCancel} onOpenChange={setAskCancel}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>放棄這段錄音？</DialogTitle>
            <DialogDescription>錄到一半的內容不會保留。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setAskCancel(false)}>
              繼續錄
            </Button>
            <Button variant="destructive" className="h-11" onClick={cancel}>
              放棄
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 原型「沒訊號 · 待送出」：錄音已存在手機，列出待送出的錄音，恢復連線自動送出 */
function SavedOnPhone({ offline, onContinue }: { offline: boolean; onContinue: () => void }) {
  const { items } = useUploadQueue()
  const pending = items.filter((item) => item.state === "pending")
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <div className="flex size-20 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CloudOff className="size-9" />
      </div>
      <div className="space-y-1">
        <p className="text-xl font-semibold">錄音已存在手機</p>
        <p className="text-sm text-muted-foreground">{offline ? "這個位置沒有訊號，紀錄不會遺失" : "現在連不上伺服器，紀錄不會遺失"}</p>
      </div>
      <div className="w-full rounded-xl border bg-card px-4 text-left">
        {pending.map((item) => (
          <div key={item.clientRef} className="flex min-h-14 items-center gap-3 border-b py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.customerName}</p>
              <p className="text-xs text-muted-foreground">
                {formatElapsed(item.durationSeconds)} ·{" "}
                {new Date(item.recordedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })} 錄製
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">待送出</span>
          </div>
        ))}
        <div className="flex min-h-12 items-center justify-between">
          <span className="text-sm text-muted-foreground">待送出合計</span>
          <span className="text-sm font-semibold">{pending.length} 筆</span>
        </div>
      </div>
      <p className="w-full rounded-xl border bg-card px-4 py-3 text-left text-sm text-muted-foreground">
        回到有收訊的地方會自動送出，不需要再操作一次。
      </p>
      <Button className="h-12 w-full text-base" onClick={onContinue}>
        繼續跑下一站
      </Button>
    </div>
  )
}
