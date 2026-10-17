import { Check, Ghost, LockKeyhole, Sparkles } from "@/components/icons"
import type { AssistantAchievement, Collected } from "@/lib/mascot-collection"

export function AssistantAchievements({ achievements }: { achievements?: Collected<AssistantAchievement>[] }) {
  if (!achievements?.length) return null
  return <section className="mt-8 border-t pt-6" aria-label="熊熊隱藏成就">
    <div className="mb-4 flex items-center gap-2"><Sparkles className="size-5 text-primary" /><h2 className="text-lg font-bold">隱藏成就</h2><span className="ml-auto text-sm text-muted-foreground">{achievements.filter((item) => item.owned).length} / {achievements.length}</span></div>
    <div className="grid gap-3 sm:grid-cols-2">{achievements.map((item) => <div key={item.id} className={`flex items-center gap-4 rounded-2xl border p-4 ${item.owned ? "border-primary/25 bg-primary/5" : "bg-muted/30"}`}>
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${item.owned ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{item.id === "ghost" ? <Ghost className="size-6" /> : <Sparkles className="size-6" />}</span>
      <div><h3 className="flex items-center gap-2 text-sm font-bold">{item.title}{item.owned ? <Check className="size-4 text-primary" /> : <LockKeyhole className="size-3 text-muted-foreground" />}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.owned ? "已解鎖" : "等你發現"}</p></div>
    </div>)}</div>
  </section>
}
