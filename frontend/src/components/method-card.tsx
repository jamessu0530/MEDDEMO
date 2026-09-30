import { useState } from "react"
import { ChevronDown, ThumbsDown, ThumbsUp } from "lucide-react"

import { customerTypeLabel, sendMethodFeedback, type MethodCard } from "@/api/methods"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { tagLabel } from "@/lib/methods"
import { cn } from "@/lib/utils"

type MethodCardItemProps = {
  card: MethodCard
  // 在哪一家客戶的談判卡上看這張卡，回饋會記在那家客戶上；方法卡頁不帶
  customerId?: string
  // 按完回饋，後端回來的這張卡（次數與我按的答案都是按完之後的），由外面換掉清單裡的那一張
  onChanged: (card: MethodCard) => void
}

/**
 * 一張方法卡：先看標題、什麼時候用、適用類型、作者與採用次數；點開看做法，底下按「有幫上／沒幫上」。
 * 按過的那顆保持選取，可以改。做法是主管寫的原文，照原樣顯示。方法卡頁、談判卡與新人頁共用。
 */
export function MethodCardItem({ card, customerId, onChanged }: MethodCardItemProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function press(helped: boolean) {
    // 已經選的那顆再按一次不必送：答案沒變
    if (busy || card.my_feedback === helped) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await sendMethodFeedback(card.id, helped, customerId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有送出，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-2xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-col gap-2 p-4 text-left"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="leading-snug font-medium">{card.title}</span>
          <ChevronDown
            className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{card.situation}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{customerTypeLabel(card.customer_type)}</Badge>
          {card.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tagLabel(tag)}
            </Badge>
          ))}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {card.author_name} · 採用 <span className="tabular-nums">{card.adopted}</span> 次
        </span>
      </button>
      {open && (
        <div className="border-t px-4 pt-3 pb-4">
          <p className="text-sm leading-relaxed whitespace-pre-line">{card.approach}</p>
          <div className="mt-4 flex gap-2">
            <Button
              variant={card.my_feedback === true ? "default" : "outline"}
              className="h-11 flex-1"
              aria-pressed={card.my_feedback === true}
              disabled={busy}
              onClick={() => press(true)}
            >
              <ThumbsUp />
              有幫上
            </Button>
            <Button
              variant={card.my_feedback === false ? "default" : "outline"}
              className="h-11 flex-1"
              aria-pressed={card.my_feedback === false}
              disabled={busy}
              onClick={() => press(false)}
            >
              <ThumbsDown />
              沒幫上
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </article>
  )
}
