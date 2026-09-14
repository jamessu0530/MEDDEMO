import { useEffect, useRef, useState } from "react"
import { Loader2, Mic, X } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import { getCustomer, type Customer } from "@/api/customers"
import { uploadAudio } from "@/api/visits"
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

type Phase =
  | { name: "idle" }
  | { name: "recording"; startedAt: number }
  | { name: "uploading" }
  | { name: "error"; message: string; canResend: boolean }

// iOS Safari 只錄得出 mp4，Chrome／Android 是 webm，挑瀏覽器支援的第一個
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]

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
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: "idle" })
  const [elapsed, setElapsed] = useState(0)
  const [askCancel, setAskCancel] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingRef = useRef<{ blob: Blob; filename: string; clientRef: string } | null>(null)
  const discardRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    getCustomer(customerId, controller.signal)
      .then(setCustomer)
      .catch(() => {})
    return () => controller.abort()
  }, [customerId])

  useEffect(() => {
    if (phase.name !== "recording") return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)), 250)
    return () => clearInterval(timer)
  }, [phase])

  // 離開頁面時一定要關掉麥克風，錄到一半離開就當作放棄
  useEffect(
    () => () => {
      discardRef.current = true
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    },
    []
  )

  async function send() {
    const recording = recordingRef.current
    if (!recording) return
    setPhase({ name: "uploading" })
    try {
      const visit = await uploadAudio(customerId, recording.blob, recording.filename, recording.clientRef)
      navigate(`/visits/${visit.id}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : "上傳失敗"
      setPhase({ name: "error", message: `錄音還在手機上，沒有上傳成功：${message}`, canResend: true })
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ name: "error", message: "瀏覽器不允許這個網址錄音，請改用 HTTPS 網址開啟。", canResend: false })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (discardRef.current) return
        const type = recorder.mimeType || mimeType || "audio/webm"
        // 錄音編號在這裡定下來；上傳失敗重送時沿用同一個，伺服器就不會建出兩筆
        recordingRef.current = {
          blob: new Blob(chunksRef.current, { type }),
          filename: `visit.${extensionFor(type)}`,
          clientRef: crypto.randomUUID(),
        }
        void send()
      }
      recorder.start()
      recorderRef.current = recorder
      setElapsed(0)
      setPhase({ name: "recording", startedAt: Date.now() })
    } catch (error) {
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
    navigate("/")
  }

  const recording = phase.name === "recording"

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="口述拜訪紀錄"
        subtitle={customer?.name}
        backTo="/"
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

        {phase.name === "error" && (
          <div className="w-full">
            <Notice
              text={phase.message}
              action={
                phase.canResend
                  ? { label: "重新上傳", onClick: () => void send() }
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
