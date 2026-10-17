import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { CompletionCelebration } from "@/components/completion-celebration"
import { COMPLETION_CELEBRATION_MS } from "@/lib/completion-celebration"

import "../index.css"

const TASKS = [
  { label: "完成拜訪回寫", message: "拜訪紀錄回寫完成！", hint: "拜訪紀錄成功寫入三套系統" },
  { label: "完成訂單送出", message: "訂單成功送出！", hint: "訂單送至 SAP 並生效" },
  { label: "完成課程闖關", message: "闖關成功！", hint: "通過新人課程或品類練習" },
]

export function Preview() {
  const [frame, setFrame] = useState(false)
  const [replay, setReplay] = useState(0)
  const [slow, setSlow] = useState(false)
  const [message, setMessage] = useState("闖關成功！")
  const duration = COMPLETION_CELEBRATION_MS * (slow ? 2 : 1)

  useEffect(() => {
    if (frame) return
    const timer = window.setTimeout(() => setReplay((n) => n + 1), duration + 500)
    return () => window.clearTimeout(timer)
  }, [frame, replay, duration])

  function play(nextMessage = message) {
    setMessage(nextMessage)
    setFrame(false)
    setReplay((n) => n + 1)
  }
  return <main className="mx-auto flex min-h-svh max-w-4xl flex-col justify-center gap-5 px-6 py-6 md:gap-8 md:py-12">
    <header>
      <p className="mb-3 text-xs font-semibold tracking-widest text-primary">熊熊滾 · 動畫預覽</p>
      <h1 className="text-2xl leading-snug font-bold md:text-3xl">又完成一件事，<br />開心到飛起來！</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">笑瞇瞇地彈起、輕輕飄高，再帶著星星向上飛。</p>
    </header>
    <section className="grid gap-6 md:grid-cols-2">
      <div className="relative flex min-h-[370px] items-center justify-center overflow-hidden rounded-3xl border-2 bg-primary/5 md:min-h-96">
        <div className="preview-flight-frame" key={replay}><CompletionCelebration message={message} duration={duration} pausedAt={frame ? .42 : undefined} /></div>
      </div>
      <div className="flex flex-col justify-center gap-3">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-1 md:gap-3">
          {TASKS.map((task) => <button key={task.label} type="button" className="rounded-2xl border-2 bg-card px-3 py-3 text-left text-sm shadow-lip transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary md:px-5 md:py-4 md:text-base" onClick={() => play(task.message)}>
            <span className="block font-semibold">{task.label}<span className="float-right hidden text-primary md:inline" aria-hidden="true">↗</span></span>
            <span className="mt-1 hidden text-xs text-muted-foreground md:block">{task.hint}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap justify-center gap-x-5">
          <button type="button" className="min-h-11 text-sm font-semibold text-primary underline underline-offset-4" onClick={() => play()}>重播動畫</button>
          <button type="button" aria-pressed={slow} className="min-h-11 text-sm text-primary underline underline-offset-4" onClick={() => { setSlow(!slow); play() }}>{slow ? "恢復正常速度" : "慢速看動作"}</button>
          <button type="button" className="min-h-11 text-sm text-primary underline underline-offset-4" onClick={() => { setFrame(true); setReplay((n) => n + 1) }}>定格看起飛姿勢</button>
        </div>
      </div>
    </section>
    <p className="text-xs leading-relaxed text-muted-foreground">預覽會連續播放，不會送出訂單或修改紀錄。正式操作成功後只播一次，約 2.8 秒自動收起。</p>
    <style>{`.preview-flight-frame { position: absolute; inset: 0; } .preview-flight-frame .completion-celebration { top: 0; }`}</style>
  </main>
}

const root = createRoot(document.getElementById("root")!)
root.render(<StrictMode><Preview /></StrictMode>)
// A preview reload must clean up the old player and its replay timer.
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
