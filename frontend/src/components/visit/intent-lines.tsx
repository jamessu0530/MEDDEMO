import type { PromotionItem } from "@/api/promotions"
import type { Visit } from "@/api/visits"
import { ChangeNote } from "@/components/change-note"
import { intentLine } from "@/components/visit/field-format"
import { repeatHeader, repeatNotes } from "@/lib/repeat"

/**
 * 意向照上次展開時，一項一行，下面寫促銷變了什麼與跟上次比加減多少（lib/repeat.ts）。
 * 照品項與口對快照；業務刪掉的那一列，那句話就不出現
 */
export function IntentLines({ visit, packs }: { visit: Visit; packs: Record<string, PromotionItem> }) {
  const snapshot = visit.repeat_last
  if (!snapshot) return null
  const items = visit.fields.intent ?? []
  const header = repeatHeader(snapshot)
  return (
    <span className="flex flex-col gap-1.5">
      {header && <span className="text-xs font-normal text-muted-foreground">{header}</span>}
      {snapshot.all && snapshot.except_names.length > 0 && (
        <span className="text-xs font-normal text-muted-foreground">這次不要：{snapshot.except_names.join("、")}</span>
      )}
      {items.length === 0 && <span className="font-normal text-muted-foreground">沒提到</span>}
      {items.map((item, index) => {
        const { warnings, notes } = repeatNotes(item, snapshot)
        return (
          <span key={`${item.sku}-${item.promo_code}-${index}`} className="flex flex-col gap-0.5">
            <span>{intentLine(item, item.promo_code ? packs[item.promo_code] : undefined)}</span>
            {warnings.map((text) => (
              <ChangeNote key={text} text={text} className="font-normal" />
            ))}
            {notes.map((text) => (
              <span key={text} className="text-xs font-normal text-muted-foreground">
                {text}
              </span>
            ))}
          </span>
        )
      })}
    </span>
  )
}
