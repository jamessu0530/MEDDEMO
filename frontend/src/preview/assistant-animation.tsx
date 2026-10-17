import { StrictMode, useEffect, useRef, useState, type CSSProperties } from "react"
import { createRoot } from "react-dom/client"
import { ArrowLeft, ArrowRight, Ghost, RotateCcw, Sparkles } from "@/components/icons"

import { ASSISTANT_TRANSITION_MS, type AssistantTransitionAction } from "@/ask/use-assistant-transition"
import { useAssistantSwipe } from "@/ask/use-assistant-swipe"
import { AssistantModeTransition } from "@/components/ask/assistant-mode-transition"
import { AssistantSwipeUnlock } from "@/components/ask/assistant-swipe-unlock"
import { AssistantAchievements } from "@/components/ask/assistant-achievements"
import { Mascot } from "@/components/mascot"
import type { AssistantAchievement, AssistantAchievementUnlock, Collected } from "@/lib/mascot-collection"

import "../index.css"

const INITIAL: Collected<AssistantAchievement>[] = [
  { id: "ghost", title: "神出鬼沒", description: "第一次向右滑，讓熊熊滾戴上鬼面具。", owned: false, unlocked_at: null },
  { id: "new", title: "熊熊影分身", description: "第一次向左滑，開啟新對話並召喚兩隻熊熊滾。", owned: false, unlocked_at: null },
]

export function Preview() {
  const sequence = useRef(0)
  const [mode, setMode] = useState<AssistantTransitionAction>("new")
  const [event, setEvent] = useState<{ id: number; action: AssistantTransitionAction; unlock: AssistantAchievementUnlock } | null>(null)
  const [achievements, setAchievements] = useState(INITIAL)
  const [slow, setSlow] = useState(false)
  const [paused, setPaused] = useState(false)
  const duration = ASSISTANT_TRANSITION_MS * (slow ? 2 : 1)
  function play(action: AssistantTransitionAction) {
    const previous = achievements.find((item) => item.id === action)!
    const achievement = { ...previous, owned: true, unlocked_at: previous.unlocked_at ?? new Date().toISOString() }
    setAchievements((items) => items.map((item) => item.id === action ? achievement : item))
    setMode(action)
    setEvent({ id: ++sequence.current, action, unlock: { achievement, newly_unlocked: !previous.owned } })
  }
  const { dragging, preview, ...swipe } = useAssistantSwipe(play)
  useEffect(() => {
    if (!event || paused) return
    const timer = window.setTimeout(() => setEvent(null), duration)
    return () => window.clearTimeout(timer)
  }, [event, paused, duration])

  return <main className="mx-auto flex min-h-svh max-w-5xl flex-col justify-center gap-7 px-5 py-10 sm:px-8">
    <header><p className="mb-3 text-xs font-bold tracking-[.2em] text-primary">熊熊滾 · 小小魔法，大大冒險</p><h1 className="text-3xl leading-snug font-bold sm:text-4xl">滑一下，<br />熊熊有新把戲。</h1><p className="mt-4 text-sm leading-relaxed text-muted-foreground">一隻悄悄戴上鬼面具，一隻噗地變成兩隻。<br />試試滑動下面的對話框，發現兩個隱藏成就。</p></header>
    <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
      <section className="relative flex min-h-[370px] flex-col justify-end overflow-hidden rounded-3xl border bg-primary/5 p-4 sm:p-6" aria-label="動畫舞台">
        <span className="absolute top-5 left-5 rounded-full bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">互動預覽</span>
        {event && <div className="pointer-events-none absolute inset-0" style={{ "--mode-bottom": "62px" } as CSSProperties}><AssistantModeTransition key={event.id} action={event.action} unlock={event.unlock} duration={duration} pausedAt={paused ? .53 : undefined} /></div>}
        {!event && <div className="flex flex-1 flex-col items-center justify-center gap-2"><Mascot state="hi" size={110} /><span className="text-xs text-muted-foreground">熊熊準備好變魔法了</span></div>}
        <div {...swipe} data-swipe-direction={dragging ?? undefined} data-preview-mode={mode} tabIndex={0} aria-label="向右滑開啟 Ghost mode，向左滑開新對話" onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); play(e.key === "ArrowRight" ? "ghost" : "new") } }} className={`relative z-0 flex h-14 cursor-grab touch-pan-y items-center gap-3 overflow-hidden rounded-2xl border-2 bg-card px-3 shadow-sm focus-visible:outline-2 focus-visible:outline-primary ${mode === "ghost" ? "border-dashed border-primary/50" : "border-border"}`}>
          <Mascot size={28} bust /><span className="flex-1 text-sm text-muted-foreground">輸入問題…</span><span className="text-primary" aria-hidden="true">↑</span>
          {preview && <AssistantSwipeUnlock preview={preview} />}
        </div>
      </section>
      <section className="flex flex-col justify-center gap-3" aria-label="播放控制">
        <button type="button" onClick={() => play("ghost")} className="flex min-h-20 items-center gap-4 rounded-2xl border bg-card p-5 text-left shadow-lip hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Ghost className="size-6" /></span><span className="flex-1"><strong className="text-sm">鬼面具出動</strong><span className="mt-1 block text-xs text-muted-foreground">從框邊跑出 → 戴面具 → 悄悄溜走</span></span><ArrowRight className="size-4 text-primary" /></button>
        <button type="button" onClick={() => play("new")} className="flex min-h-20 items-center gap-4 rounded-2xl border bg-card p-5 text-left shadow-lip hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Sparkles className="size-6" /></span><span className="flex-1"><strong className="text-sm">熊熊影分身</strong><span className="mt-1 block text-xs text-muted-foreground">翻滾跑來 → 噗！ → 兩隻一起跑</span></span><ArrowLeft className="size-4 text-primary" /></button>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-primary">
          <button type="button" onClick={() => play(mode)} className="flex min-h-11 items-center gap-1 underline underline-offset-4"><RotateCcw className="size-3" />重播</button>
          <button type="button" aria-pressed={slow} onClick={() => { setSlow(!slow); play(mode) }} className="min-h-11 underline underline-offset-4">{slow ? "正常速度" : "慢速播放"}</button>
          <button type="button" aria-pressed={paused} onClick={() => { setPaused(!paused); play(mode) }} className="min-h-11 underline underline-offset-4">{paused ? "繼續播放" : "定格看動作"}</button>
          <button type="button" onClick={() => { setAchievements(INITIAL); setEvent(null) }} className="min-h-11 text-muted-foreground underline underline-offset-4">重設成就</button>
        </div>
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">左右滑動像解鎖一樣跟手；滑到一半往回收，熊熊會跑回去。滑到底再放開才切換，輸入框維持原本大小。首次完成會亮起成就。</p>
      </section>
    </div>
    <AssistantAchievements achievements={achievements} />
    <p className="text-[11px] text-muted-foreground">這裡只預覽動畫與成就，不連線、不更動帳號。支援減少動態效果設定。</p>
  </main>
}

const root = createRoot(document.getElementById("root")!)
root.render(<StrictMode><Preview /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
