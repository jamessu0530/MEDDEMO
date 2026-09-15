/**
 * 一段語音問答的連線與狀態。手機直接跟 Gemini Live 講話（後端只發臨時金鑰）；
 * 模型要查資料時送來工具呼叫，這裡把問題交給問答 API，查完再把結果交回模型講出來。
 * 畫面透過 subscribe／getView 讀狀態（React 的 useSyncExternalStore）。
 */

import {
  GoogleGenAI,
  type FunctionCall,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai"

import { createAsk, getAsk, isFinished, type Ask, type AskKind } from "@/api/asks"
import { ApiError } from "@/api/client"
import { startVoiceSession } from "@/api/voice"
import { TABLE_PREVIEW_ROWS } from "@/components/ask/ask-result"
import { CueLoop, INPUT_MIME_TYPE, PcmPlayer, openMicrophone, startCapture, toBase64 } from "@/voice/audio"
import { tidyTranscript } from "@/voice/transcript"

// 模型在等查詢結果，輪詢間隔會直接加在業務的等待時間上；單人使用，每秒問兩次對 API 沒有負擔
const POLL_MS = 500
// 麥克風開著就一直把聲音送去 Gemini，音訊照秒數計費；一問一答之間一分鐘都沒動靜，多半是忘了按結束
const IDLE_LIMIT_MS = 60_000
const IDLE_CHECK_MS = 5_000
// 問答 API 收的問題長度上限（backend/app/api/asks.py）
const MAX_QUESTION_LENGTH = 500
const RESTART_HINT = "要再問就按「開始對話」。"
// 查資料時的提示音（frontend/public/sounds/README.md 記了來源與授權）
const QUERYING_SOUND_URL = "/sounds/querying.wav"

export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking"
export type Utterance = { id: number; kind: "user" | "model"; text: string }
export type ToolRun = {
  id: number
  kind: "tool"
  askKind: AskKind | null
  question: string
  ask: Ask | null
  error: string | null
  cancelled: boolean
}
export type Entry = Utterance | ToolRun
export type VoiceView = {
  status: VoiceStatus
  entries: Entry[]
  notice: string | null
  level: number
  pending: number
}

type Connection = {
  context: AudioContext
  player: PcmPlayer
  cue: CueLoop
  session: Session | null
  stream: MediaStream | null
  stopCapture: (() => void) | null
  idleTimer: number | undefined
  toolKinds: Record<string, AskKind>
  userEntry: number | null
  modelEntry: number | null
  toolEntries: Map<string, number>
  cancelled: Set<string>
  // 業務按了「打斷」：這一輪模型還在送來的聲音都不播
  dropModelAudio: boolean
  goingAway: boolean
  lastActivity: number
  pending: number
}

const STATUS_FOR_MODEL: Partial<Record<Ask["status"], string>> = {
  answered: "查到答案",
  no_evidence: "查無依據",
  not_converged: "查到上限仍不完整",
}

/** 交回給模型的查詢結果：答案、狀態，以及畫面上看得到的依據（結果表前幾列或出處標題） */
function toolResult(ask: Ask): Record<string, unknown> {
  if (ask.status === "failed") return { error: ask.error_message ?? "查詢失敗" }
  const evidence = ask.evidence ?? {}
  return {
    output: {
      status: STATUS_FOR_MODEL[ask.status],
      answer: ask.answer,
      // 知識題的答案來自內部文件（kb）或網路公開資料（web）；web 的要讓業務聽得出不是公司規定。
      // reason 是刻意不上網的原因：medical（用藥題，請業務問醫師或藥師、不提轉主管）、internal（只有公司內部才有答案）
      ...(evidence.route ? { route: evidence.route } : {}),
      ...(evidence.reason ? { reason: evidence.reason } : {}),
      ...(evidence.blocked_reason ? { blocked_reason: evidence.blocked_reason } : {}),
      ...(evidence.columns && evidence.rows
        ? { table: { columns: evidence.columns, rows: evidence.rows.slice(0, TABLE_PREVIEW_ROWS) } }
        : {}),
      ...(evidence.sources?.length
        ? { sources: evidence.sources.map((source) => `${source.doc_title}｜${source.section}`) }
        : {}),
    },
  }
}

function describeStartError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "沒有麥克風權限。請到瀏覽器設定允許這個網站使用麥克風，再試一次。"
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return "找不到麥克風。"
  if (error instanceof ApiError) return error.message
  return `語音連線失敗：${error instanceof Error ? error.message : String(error)}`
}

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

export class VoiceController {
  private view: VoiceView = { status: "idle", entries: [], notice: null, level: 0, pending: 0 }
  private readonly listeners = new Set<() => void>()
  // 離開頁面時停止所有輪詢；對話結束但查詢還沒完成的，卡片照樣更新到查完
  private polls = new AbortController()
  private conn: Connection | null = null
  private lastId = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getView = () => this.view

  start = async () => {
    if (this.conn) return
    if (!navigator.mediaDevices?.getUserMedia) {
      this.update({ notice: "瀏覽器不允許這個網址使用麥克風，請改用 HTTPS 網址開啟。" })
      return
    }
    // iOS 只允許在使用者點擊的當下開啟聲音：AudioContext 要在點擊後立刻建立，不能等連線完成
    const context = new AudioContext()
    void context.resume()
    const player: PcmPlayer = new PcmPlayer(context, (playing) => this.onPlayingChange(player, playing))
    const cue = new CueLoop(context, QUERYING_SOUND_URL)
    void cue.preload()
    const conn: Connection = {
      context,
      player,
      cue,
      session: null,
      stream: null,
      stopCapture: null,
      idleTimer: undefined,
      toolKinds: {},
      userEntry: null,
      modelEntry: null,
      toolEntries: new Map(),
      cancelled: new Set(),
      dropModelAudio: false,
      goingAway: false,
      lastActivity: Date.now(),
      pending: 0,
    }
    this.conn = conn
    this.update({ status: "connecting", notice: null })
    try {
      // 先拿麥克風權限：臨時金鑰只給 1 分鐘開始連線，不能卡在權限視窗上
      conn.stream = await openMicrophone()
      const voice = await startVoiceSession()
      if (this.conn !== conn) return // 連線途中按了結束
      conn.toolKinds = voice.tool_kinds
      const ai = new GoogleGenAI({ apiKey: voice.token, httpOptions: { apiVersion: voice.api_version } })
      conn.session = await ai.live.connect({
        model: voice.model,
        config: voice.config as LiveConnectConfig,
        callbacks: {
          onmessage: (message) => this.onMessage(conn, message),
          onerror: () => this.finish(conn, `語音連線發生錯誤。${RESTART_HINT}`),
          onclose: (event) =>
            this.finish(
              conn,
              conn.goingAway
                ? `這段對話到了連線時間上限。${RESTART_HINT}`
                : `語音連線中斷了${event.reason ? `（${event.reason}）` : ""}。${RESTART_HINT}`
            ),
        },
      })
      if (this.conn !== conn) {
        conn.session.close()
        return
      }
      conn.stopCapture = await startCapture(context, conn.stream, (pcm, level) => this.onChunk(conn, pcm, level))
      conn.lastActivity = Date.now()
      conn.idleTimer = window.setInterval(() => {
        if (conn.pending === 0 && !conn.player.playing && Date.now() - conn.lastActivity > IDLE_LIMIT_MS) {
          this.finish(conn, `一分鐘沒有對話，已經自動結束。${RESTART_HINT}`)
        }
      }, IDLE_CHECK_MS)
      this.update({ status: "listening" })
    } catch (error) {
      this.finish(conn, describeStartError(error))
    }
  }

  stop = () => {
    if (this.conn) this.finish(this.conn, null)
  }

  /** 模型說話時不收音；業務要插話，就先停掉正在播的聲音，接著開口 */
  interrupt = () => {
    const conn = this.conn
    if (!conn) return
    conn.dropModelAudio = true
    conn.player.stop()
  }

  /** 畫面上的操作改了提問（例如轉給主管），更新對應的卡片 */
  replaceAsk = (entryId: number, ask: Ask) => this.patchTool(entryId, { ask })

  /** 頁面掛上時呼叫。React 開發模式會先卸載再掛上一次，所以卸載時停掉的輪詢要能重新開始 */
  attach = () => {
    if (this.polls.signal.aborted) this.polls = new AbortController()
  }

  /** 離開頁面：掛斷、關麥克風、停止輪詢 */
  detach = () => {
    this.polls.abort()
    this.stop()
  }

  private update(patch: Partial<VoiceView>) {
    this.view = { ...this.view, ...patch }
    for (const listener of this.listeners) listener()
  }

  private patchTool(entryId: number, patch: Partial<Omit<ToolRun, "id" | "kind">>) {
    this.update({
      entries: this.view.entries.map((entry) => (entry.id === entryId && entry.kind === "tool" ? { ...entry, ...patch } : entry)),
    })
  }

  private finish(conn: Connection, notice: string | null) {
    if (this.conn !== conn) return
    this.conn = null
    window.clearInterval(conn.idleTimer)
    conn.stopCapture?.()
    conn.stream?.getTracks().forEach((track) => track.stop())
    conn.cue.stop()
    conn.player.stop()
    conn.session?.close()
    void conn.context.close()
    this.update({ status: "idle", level: 0, pending: 0, notice })
  }

  private onChunk(conn: Connection, pcm: ArrayBuffer, level: number) {
    if (this.conn !== conn || !conn.session) return
    this.update({ level })
    // 半雙工：模型說話時不送麥克風的聲音，手機外放時模型才不會聽到自己的聲音、把自己打斷。
    // 查資料時也不送：模型本來就要等查詢結果才能回應，而且提示音會被麥克風收進去
    if (conn.player.playing || conn.pending > 0) return
    conn.session.sendRealtimeInput({ audio: { data: toBase64(pcm), mimeType: INPUT_MIME_TYPE } })
  }

  private onPlayingChange(player: PcmPlayer, playing: boolean) {
    const conn = this.conn
    if (!conn || conn.player !== player) return
    conn.lastActivity = Date.now()
    // 模型一開口就告訴 Gemini 麥克風暫停了，它才會把已經收到的聲音處理完
    if (playing) conn.session?.sendRealtimeInput({ audioStreamEnd: true })
    // 提示音不跟 AI 的聲音疊在一起；AI 講完但還在查，就再接著播
    if (playing) conn.cue.stop()
    else if (conn.pending > 0) conn.cue.start()
    if (this.view.status !== "connecting") this.update({ status: playing ? "speaking" : "listening" })
  }

  private onMessage(conn: Connection, message: LiveServerMessage) {
    if (this.conn !== conn) return
    const content = message.serverContent
    if (content) {
      conn.lastActivity = Date.now()
      if (content.interrupted) {
        conn.player.stop()
        conn.modelEntry = null
        conn.dropModelAudio = false
      }
      for (const part of content.modelTurn?.parts ?? []) {
        const audio = part.inlineData
        if (audio?.data && audio.mimeType?.startsWith("audio/pcm") && !conn.dropModelAudio) conn.player.play(audio.data)
      }
      if (content.inputTranscription?.text) this.appendText(conn, "user", content.inputTranscription.text)
      if (content.outputTranscription?.text) this.appendText(conn, "model", content.outputTranscription.text)
      if (content.turnComplete) {
        conn.userEntry = null
        conn.modelEntry = null
        conn.dropModelAudio = false
      }
    }
    for (const call of message.toolCall?.functionCalls ?? []) void this.runTool(conn, call)
    for (const id of message.toolCallCancellation?.ids ?? []) {
      conn.cancelled.add(id)
      const entryId = conn.toolEntries.get(id)
      if (entryId !== undefined) this.patchTool(entryId, { cancelled: true })
    }
    if (message.goAway) conn.goingAway = true
  }

  /** 找這一輪業務（或模型）講話的那一格，沒有就開一格 */
  private openEntry(conn: Connection, kind: "user" | "model"): number {
    const current = kind === "user" ? conn.userEntry : conn.modelEntry
    if (current !== null) return current
    // 業務講話的逐字稿可能比模型的回答或工具呼叫晚到；先幫業務這一句佔位，順序才不會顛倒
    if (kind === "model") this.openEntry(conn, "user")
    const id = ++this.lastId
    if (kind === "user") conn.userEntry = id
    else conn.modelEntry = id
    this.update({ entries: [...this.view.entries, { id, kind, text: "" }] })
    return id
  }

  private appendText(conn: Connection, kind: "user" | "model", text: string) {
    const id = this.openEntry(conn, kind)
    this.update({
      entries: this.view.entries.map((entry) =>
        entry.id === id && entry.kind === kind ? { ...entry, text: tidyTranscript(entry.text + text) } : entry
      ),
    })
  }

  private async runTool(conn: Connection, call: FunctionCall) {
    const askKind = (call.name && conn.toolKinds[call.name]) || null
    const rawQuestion = call.args?.question
    const question = typeof rawQuestion === "string" ? rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH) : ""
    this.openEntry(conn, "user")
    const entryId = ++this.lastId
    if (call.id) conn.toolEntries.set(call.id, entryId)
    this.update({
      entries: [
        ...this.view.entries,
        { id: entryId, kind: "tool", askKind, question, ask: null, error: null, cancelled: false },
      ],
    })
    conn.pending += 1
    this.update({ pending: conn.pending })
    if (conn.pending === 1) {
      conn.session?.sendRealtimeInput({ audioStreamEnd: true }) // 查資料期間暫停收音
      if (!conn.player.playing) conn.cue.start()
    }

    const signal = this.polls.signal
    let response: Record<string, unknown>
    try {
      if (!askKind) throw new Error(`沒有這個查詢工具：${call.name}`)
      if (!question) throw new Error("模型沒有給要查的問題")
      let ask = await createAsk(askKind, question)
      this.patchTool(entryId, { ask })
      while (!isFinished(ask)) {
        await sleep(POLL_MS, signal)
        try {
          ask = await getAsk(ask.id, signal)
        } catch (error) {
          if (signal.aborted) throw error
          continue // 網路一時不通就等下一輪
        }
        this.patchTool(entryId, { ask })
      }
      response = toolResult(ask)
    } catch (error) {
      if (signal.aborted) return
      const message = error instanceof Error ? error.message : "查詢失敗"
      this.patchTool(entryId, { error: message })
      response = { error: message }
    }

    conn.pending -= 1
    conn.lastActivity = Date.now()
    if (conn.pending === 0) conn.cue.stop()
    if (this.conn !== conn || !conn.session || (call.id && conn.cancelled.has(call.id))) return
    this.update({ pending: conn.pending })
    conn.session.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] })
  }
}
