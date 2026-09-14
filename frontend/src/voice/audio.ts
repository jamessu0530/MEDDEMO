/**
 * 語音問答的收音與播放。Gemini Live 收 16kHz、16-bit、單聲道的 PCM，回來的聲音是 24kHz 的 PCM
 * （ai.google.dev/gemini-api/docs/live-guide）。
 */

const INPUT_SAMPLE_RATE = 16000
const OUTPUT_SAMPLE_RATE = 24000
// 每 100ms 送一段（1,600 個取樣），官方建議的大小（ai.google.dev/gemini-api/docs/live-api/live-transcribe）
const CHUNK_SAMPLES = 1600
export const INPUT_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

// AudioWorklet 在獨立的音訊執行緒跑，只能從網址載入；寫成字串再轉成 Blob 網址，打包設定不必另外處理。
// 手機麥克風多半是 48kHz 或 44.1kHz：把落在同一個輸出取樣區間的輸入取樣平均起來再降到 16kHz，
// 平均本身就是簡單的低通，高頻不會折疊成雜音
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { targetRate, chunkSamples } = options.processorOptions
    this.step = sampleRate / targetRate
    this.position = 0
    this.sum = 0
    this.count = 0
    this.squares = 0
    this.chunkSamples = chunkSamples
    this.chunk = new Int16Array(chunkSamples)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]
      this.count += 1
      this.position += 1
      if (this.position < this.step) continue
      this.position -= this.step
      const value = Math.max(-1, Math.min(1, this.sum / this.count))
      this.sum = 0
      this.count = 0
      this.squares += value * value
      this.chunk[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff
      if (this.filled === this.chunkSamples) {
        const level = Math.sqrt(this.squares / this.filled)
        // 轉移之後原本的 buffer 就不能再用（長度變 0），所以每段都開新的
        this.port.postMessage({ pcm: this.chunk.buffer, level }, [this.chunk.buffer])
        this.chunk = new Int16Array(this.chunkSamples)
        this.filled = 0
        this.squares = 0
      }
    }
    return true
  }
}
registerProcessor("pcm-capture", PcmCapture)
`

export function openMicrophone() {
  // 回音消除：手機外放時，減少模型把自己的聲音當成業務在說話
  return navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}

/** 開始把麥克風的聲音切成 100ms 一段交給 onChunk；level 是這一段的音量（RMS，0～1），給畫面做收音動畫 */
export async function startCapture(
  context: AudioContext,
  stream: MediaStream,
  onChunk: (pcm: ArrayBuffer, level: number) => void
) {
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }))
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, "pcm-capture", {
    processorOptions: { targetRate: INPUT_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES },
  })
  node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) =>
    onChunk(event.data.pcm, event.data.level)
  // 節點沒接到輸出，部分瀏覽器就不會執行它；接一個音量 0 的 gain，只收音、不會從喇叭放出來
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute).connect(context.destination)
  return () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    mute.disconnect()
  }
}

export function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  // 分段轉字元，避免一次展開太多參數
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

function decodePcm16(base64: string) {
  const binary = atob(base64)
  const samples = new Float32Array(binary.length >> 1)
  for (let i = 0; i < samples.length; i++) {
    const value = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8) // little-endian
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000
  }
  return samples
}

// UI SFX 對這個循環音的建議音量是 0.08（manifest.json 的 defaultVolume），那是給網頁當背景用的。
// 這裡它是查資料那 9～19 秒裡業務唯一聽得到的聲音，手機外放、店裡可能有雜音，所以調成 0.25，約比建議值大 10 dB
const CUE_VOLUME = 0.25

/** 查資料時循環播放的提示音，查完就停。音效載不到就安靜查，不影響查詢本身 */
export class CueLoop {
  private readonly context: AudioContext
  private readonly url: string
  private buffer: AudioBuffer | null = null
  private loading: Promise<void> | null = null
  private source: AudioBufferSourceNode | null = null
  private wanted = false

  constructor(context: AudioContext, url: string) {
    this.context = context
    this.url = url
  }

  /** 連線時先載好，第一次查資料就能馬上出聲 */
  preload() {
    this.loading ??= fetch(this.url)
      .then((response) => response.arrayBuffer())
      .then((data) => this.context.decodeAudioData(data))
      .then((buffer) => {
        this.buffer = buffer
        if (this.wanted) this.play()
      })
      .catch(() => {})
    return this.loading
  }

  start() {
    this.wanted = true
    if (this.buffer) this.play()
    else void this.preload()
  }

  stop() {
    this.wanted = false
    this.source?.stop()
    this.source = null
  }

  private play() {
    if (this.source || !this.buffer) return
    const gain = this.context.createGain()
    gain.gain.value = CUE_VOLUME
    const source = this.context.createBufferSource()
    source.buffer = this.buffer
    source.loop = true
    source.connect(gain).connect(this.context.destination)
    source.start()
    this.source = source
  }
}

/** 把模型回來的一段段聲音接續排好播放；業務插話時整批停掉 */
export class PcmPlayer {
  private readonly context: AudioContext
  private readonly onPlayingChange: (playing: boolean) => void
  private readonly sources = new Set<AudioBufferSourceNode>()
  private nextStart = 0

  constructor(context: AudioContext, onPlayingChange: (playing: boolean) => void) {
    this.context = context
    this.onPlayingChange = onPlayingChange
  }

  get playing() {
    return this.sources.size > 0
  }

  play(base64: string) {
    const samples = decodePcm16(base64)
    if (samples.length === 0) return
    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    // 一段接一段排好時間，中間不留空隙；前一段已經播完就從現在開始
    const startAt = Math.max(this.context.currentTime, this.nextStart)
    source.start(startAt)
    this.nextStart = startAt + buffer.duration
    const wasPlaying = this.playing
    this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source)
      if (!this.playing) this.onPlayingChange(false)
    }
    if (!wasPlaying) this.onPlayingChange(true)
  }

  stop() {
    const wasPlaying = this.playing
    for (const source of this.sources) {
      source.onended = null
      source.stop()
    }
    this.sources.clear()
    this.nextStart = 0
    if (wasPlaying) this.onPlayingChange(false)
  }
}
