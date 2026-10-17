import { useEffect, useRef, useState } from "react"
import { CheckCircle2, ChevronRight, GraduationCap, Lightbulb } from "@/components/icons"
import { Link, useParams } from "react-router"
import { ApiError } from "@/api/client"
import type { Medal } from "@/api/me"
import { completeProductLesson, getProductCourses, getProductLesson, type ProductCourse, type ProductLesson } from "@/api/product-learning"
import { MedalWall } from "@/components/me/medal-wall"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { TIER_NAME } from "@/lib/medals"
import { cn } from "@/lib/utils"

export function ProductLearningPage() {
  const userId = useAuth()?.user.id
  const { kind, tier } = useParams()
  return kind && tier ? <LessonContent key={`${userId}:${kind}:${tier}`} kind={kind} tier={tier} /> : <ProductCourses key={userId} />
}

function ProductCourses() {
  const [courses, setCourses] = useState<ProductCourse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getProductCourses(controller.signal).then(setCourses).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof ApiError ? e.message : "品類練習暫時載入不了")
    })
    return () => controller.abort()
  }, [attempt])
  return <div className="flex min-h-svh flex-col">
    <PageHeader title="品類成就" backTo="/me" />
    <main className="flex flex-col gap-5 px-4 pt-4 pb-10">
      {error && <Notice text={error} action={{ label: "再試一次", onClick: () => { setError(null); setAttempt(n => n + 1) } }} />}
      {!courses && !error && <p className="py-8 text-sm text-muted-foreground">載入品類練習中…</p>}
      {courses?.map(course => <section key={course.kind} className="rounded-3xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">{course.category}</h2><span className="text-xs text-muted-foreground">已完成 {course.completed} / 3 關</span></div>
        <div className="flex flex-col gap-2">{course.lessons.map(lesson => <Link key={lesson.tier} to={lesson.action_path}
          className={cn("flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary", lesson.locked ? "bg-muted/50 text-muted-foreground" : "bg-primary/5")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-sm">{lesson.completed ? <CheckCircle2 className="size-5 text-success" /> : TIER_NAME[lesson.tier]}</span>
          <span className="flex-1"><span className="block text-sm font-medium">{["品類辨識", "規格核對", "情境練習"][lesson.tier - 1]}</span><span className="block text-xs text-muted-foreground">{lesson.completed ? "已過關，可複習" : lesson.locked ? "先完成前一關" : "全部答對即可解鎖"}</span></span><ChevronRight className="size-4" />
        </Link>)}</div>
      </section>)}
    </main>
  </div>
}

function LessonContent({ kind, tier }: { kind: string; tier: string }) {
  const userId = useAuth()?.user.id ?? ""
  const [lesson, setLesson] = useState<ProductLesson | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ unlocked: Medal[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const submitting = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    getProductLesson(kind, tier, controller.signal).then(setLesson).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof ApiError ? e.message : "練習關卡暫時載入不了")
    })
    return () => controller.abort()
  }, [kind, tier, attempt])
  useEffect(() => {
    if (result) {
      resultRef.current?.focus({ preventScroll: true })
      resultRef.current?.scrollIntoView({ block: "start" })
    }
  }, [result])
  async function submit() {
    if (submitting.current || !lesson) return
    submitting.current = true; setSaving(true); setFeedback(null)
    try {
      const data = await completeProductLesson(kind, tier, answers)
      setLesson(data.lesson); setResult({ unlocked: data.unlocked })
    } catch (e) { setFeedback(e instanceof ApiError ? e.message : "進度還沒存成功，請保留答案再試一次。") }
    finally { submitting.current = false; setSaving(false) }
  }
  return <div className="flex min-h-svh flex-col">
    <PageHeader title={lesson ? `${lesson.category} · ${lesson.lesson_title}` : "品類練習"} subtitle={lesson ? `第 ${lesson.tier} / 3 關 · ${TIER_NAME[lesson.tier]}成就` : undefined} backTo="/learning/products" />
    <main className="flex flex-col gap-5 px-4 pt-4 pb-10">
      {error ? <Notice text={error} action={{ label: "再試一次", onClick: () => { setError(null); setAttempt(n => n + 1) } }} /> : !lesson ? <p className="py-8 text-sm text-muted-foreground">載入練習中…</p> : lesson.locked ? <>
        <Notice text={`先通過${lesson.category}的前一關，就能開啟這一關。`} /><Button asChild><Link to={`/learning/products/${kind}/${lesson.have + 1}`}>繼續目前的關卡</Link></Button>
      </> : result ? <div ref={resultRef} tabIndex={-1} className="flex scroll-mt-20 flex-col gap-5 outline-none">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-success"><CheckCircle2 />{result.unlocked.length ? "全對，獎牌解鎖！" : "複習完成！"}</h2>
        {result.unlocked.length > 0 && <MedalWall medals={result.unlocked} userId={userId} />}
        <p className="text-sm leading-relaxed">{lesson.hint}</p>
        <Button asChild className="h-12"><Link to={lesson.tier < 3 ? `/learning/products/${kind}/${lesson.tier + 1}` : "/me"}>{lesson.tier < 3 ? "繼續下一關" : "回個人頁看成就"}<ChevronRight /></Link></Button>
        <Button asChild variant="outline" className="h-12"><Link to="/me">回個人頁看進度</Link></Button>
      </div> : <>
        <div className="rounded-2xl bg-primary/5 p-4"><h2 className="flex items-center gap-2 text-base font-semibold"><GraduationCap className="size-4" />{lesson.title}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">達成條件：{lesson.condition}</p></div>
        <section aria-label="商品型錄參考" className="rounded-2xl border bg-card p-4"><h2 className="mb-3 text-base font-semibold">先看商品型錄</h2><div className="flex flex-col gap-3">{lesson.reference.map(p => <div key={p.sku} className="rounded-xl bg-muted/50 p-3">
          <p className="text-sm font-medium">{p.name}</p><p className="mt-1 text-xs text-muted-foreground">料號 {p.sku} · {p.category}</p><p className="mt-1 text-xs">規格：{p.spec || "型錄未提供"} · 基礎單位：{p.unit}</p>
        </div>)}</div></section>
        <form onSubmit={e => { e.preventDefault(); void submit() }} className="flex flex-col gap-5">
          {lesson.questions.map((q, i) => <fieldset key={q.id} disabled={saving} className="min-w-0"><legend className="mb-3 text-sm font-semibold">{i + 1}. {q.prompt}</legend><div className="flex flex-col gap-2">{q.choices.map(choice => <label key={choice.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm", answers[q.id] === choice.value ? "border-primary bg-primary/5" : "bg-card")}>
            <input type="radio" name={q.id} value={choice.value} checked={answers[q.id] === choice.value} onChange={() => { setAnswers(a => ({ ...a, [q.id]: choice.value })); setFeedback(null) }} className="size-4 shrink-0 accent-primary" required />{choice.label}
          </label>)}</div></fieldset>)}
          <button type="button" className="flex min-h-11 items-center gap-2 self-start text-sm text-muted-foreground" onClick={() => setShowHint(v => !v)} aria-expanded={showHint}><Lightbulb className="size-4" />{showHint ? "收起提示" : "需要一點提示"}</button>
          {showHint && <p className="rounded-xl bg-muted p-4 text-sm leading-relaxed">{lesson.hint}</p>}
          {feedback && <p role="alert" className="rounded-xl bg-warning/10 p-4 text-sm leading-relaxed text-warning">{feedback}</p>}
          <Button type="submit" className="h-12 w-full" disabled={saving}>{saving ? "核對並保存中…" : "檢查答案，解鎖成就"}</Button>
        </form>
      </>}
    </main>
  </div>
}
