import { useEffect, useRef, useState } from "react"
import { useAskPageContext } from "@/ask/use-page-context"
import { CloudOff, Loader2, Mic, X } from "@/components/icons"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { cachedCustomer, getCustomer } from "@/api/customers"
import { getRecordingOptions, type RecordingOptions } from "@/api/visits"
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
import {
  isTemporary,
  uploadQueue,
  useUploadQueue,
  type QueuedRecording,
} from "@/lib/offline-queue"

type Phase =
  | { name: "idle" }
  | { name: "recording"; startedAt: number }
  | { name: "uploading" }
  // 錄音存在手機，恢復連線或服務恢復後自動重試（FR-4.3）；reason 是伺服器說明的原因
  | { name: "saved"; offline: boolean; reason?: string }
  | { name: "error"; message: string; canResend: boolean }

// iOS Safari 只錄得出 mp4，Chrome／Android 是 webm，挑瀏覽器支援的第一個
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
]
const RECORDING_OPTIONS_KEY = "meddemo-recording-options"

function savedRecordingOptions(): RecordingOptions {
  try {
    const saved = JSON.parse(
      localStorage.getItem(RECORDING_OPTIONS_KEY) ?? "null"
    )
    if (
      typeof saved?.taiwanese_available === "boolean" &&
      Number.isFinite(saved?.taiwanese_max_seconds) &&
      saved.taiwanese_max_seconds > 0
    ) {
      return saved
    }
  } catch {
    // 無痕模式或舊版快取不能讀時，等伺服器回覆可用的錄音語言。
  }
  return { taiwanese_available: false, taiwanese_max_seconds: 180 }
}

function pickMimeType() {
  return (
    MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  )
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
  const [options, setOptions] = useState(savedRecordingOptions)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingRef = useRef<QueuedRecording | null>(null)
  const savedRef = useRef(false)
  const discardRef = useRef(false)
  const customerNameRef = useRef<string | null>(null)
  useAskPageContext({ facts: [
    `客戶編號：${customerId}`,
    ...(customerName ? [`客戶：${customerName}`] : ["客戶資料尚未載入"]),
    `錄音階段：${phase.name}`,
  ] })

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void getRecordingOptions(controller.signal)
        .then((current) => {
          if (controller.signal.aborted) return
          setOptions(current)
          try {
            localStorage.setItem(RECORDING_OPTIONS_KEY, JSON.stringify(current))
          } catch {
            // 無法存快取仍可在線上錄音。
          }
        })
        .catch(() => {
          /* 離線時使用上次確認的語言設定。 */
        })
    }
    refresh()
    window.addEventListener("online", refresh)
    return () => {
      controller.abort()
      window.removeEventListener("online", refresh)
    }
  }, [])

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
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)),
      250
    )
    return () => clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (
      phase.name === "recording" &&
      elapsed >= options.taiwanese_max_seconds &&
      recorderRef.current?.state === "recording"
    ) {
      recorderRef.current.stop()
    }
  }, [elapsed, options.taiwanese_max_seconds, phase.name])

  // 離開頁面時關掉麥克風，錄到一半離開就當作放棄
  useEffect(
    () => () => {
      discardRef.current = true
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
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
        // 服務暫時拒絕請求（429）也先存在手機，畫面上寫清楚原因，不要說成沒訊號
        const reason =
          error instanceof ApiError && error.status === 429
            ? message
            : undefined
        setPhase({ name: "saved", offline: !navigator.onLine, reason })
        return
      }
      // 重送也不會成功的錯誤（例如檔案太大），不留在手機裡
      if (!isTemporary(error)) void uploadQueue.remove(recording.clientRef)
      setPhase({
        name: "error",
        message: isTemporary(error)
          ? `錄音還在手機上，沒有上傳成功：${message}`
          : `上傳失敗：${message}`,
        canResend: isTemporary(error),
      })
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({
        name: "error",
        message: "瀏覽器不允許這個網址錄音，請改用 HTTPS 網址開啟。",
        canResend: false,
      })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      )
      const startedAt = Date.now()
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        if (discardRef.current) return
        setPhase({ name: "uploading" })
        const type = recorder.mimeType || mimeType || "audio/webm"
        // 錄音編號在這裡定下來；之後不管是馬上送、還是恢復連線後自動重送，伺服器都只會建一筆
        const recording: QueuedRecording = {
          clientRef: crypto.randomUUID(),
          customerId,
          customerName: customerNameRef.current ?? customerId,
          filename: `visit.${extensionFor(type)}`,
          language: "auto",
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
    } catch (error) {
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError"
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
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
  }

  function cancel() {
    discardRef.current = true
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    navigate(`/customers/${customerId}`)
  }

  const recording = phase.name === "recording"
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
            <div className="max-w-sm space-y-2">
              <p className="font-medium">華語、台語都可以說</p>
              {!options.taiwanese_available && (
                <p className="text-xs text-muted-foreground">
                  台語辨識暫時無法使用，仍可錄華語；請在確認頁核對逐字稿。
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={start}
              aria-label="開始錄音"
              className="flex size-28 press items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lip-node disabled:opacity-50"
            >
              <Mic className="size-10" />
            </button>
            <div className="space-y-1">
              <p className="font-medium">按下開始錄音</p>
            </div>
          </>
        )}

        {recording && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
              錄音中
            </div>
            <p className="font-mono text-5xl font-semibold tabular-nums">
              {formatElapsed(elapsed)}
            </p>
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

        {phase.name === "saved" && (
          <SavedOnPhone
            offline={phase.offline}
            reason={phase.reason}
            onContinue={() => navigate("/route")}
          />
        )}

        {phase.name === "error" && (
          <div className="w-full">
            <Notice
              text={phase.message}
              action={
                phase.canResend
                  ? {
                      label: "重新上傳",
                      onClick: () => {
                        if (recordingRef.current)
                          void send(recordingRef.current)
                      },
                    }
                  : {
                      label: "再試一次",
                      onClick: () => setPhase({ name: "idle" }),
                    }
              }
              secondary={
                phase.canResend
                  ? { label: "重錄", onClick: () => setPhase({ name: "idle" }) }
                  : undefined
              }
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
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setAskCancel(false)}
            >
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
function SavedOnPhone({
  offline,
  reason,
  onContinue,
}: {
  offline: boolean
  reason?: string
  onContinue: () => void
}) {
  const { items } = useUploadQueue()
  const pending = items.filter((item) => item.state === "pending")
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <div className="flex size-20 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CloudOff className="size-9" />
      </div>
      <div className="space-y-1">
        <p className="text-xl font-semibold">錄音已存在手機</p>
        <p className="text-sm text-muted-foreground">
          {reason ??
            (offline
              ? "這個位置沒有訊號，紀錄不會遺失"
              : "現在連不上伺服器，紀錄不會遺失")}
        </p>
      </div>
      <div className="w-full rounded-xl border-2 bg-card px-4 text-left shadow-lip">
        {pending.map((item) => (
          <div
            key={item.clientRef}
            className="flex min-h-14 items-center gap-3 border-b py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {item.customerName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatElapsed(item.durationSeconds)} ·{" "}
                {new Date(item.recordedAt).toLocaleTimeString("zh-TW", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}{" "}
                錄製
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
              待送出
            </span>
          </div>
        ))}
      </div>
      <Button className="h-12 w-full text-base" onClick={onContinue}>
        繼續跑下一站
      </Button>
    </div>
  )
}
