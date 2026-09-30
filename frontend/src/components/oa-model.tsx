import type { OaModel } from "@/api/oa"
import { formatProbability } from "@/lib/approval"
import { cn } from "@/lib/utils"

/**
 * 模型對優惠、合約申請的估計，給簽核的人參考：估計的核准機率，加上照門檻列的事實（帳款超過 60 天那一行標紅）。
 * 理由不是模型的特徵貢獻：那個值受標準化影響，會跟真正的原因對不上
 */
export function OaModelNote({ model, className }: { model: OaModel; className?: string }) {
  return (
    <div className={cn("rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed", className)}>
      <p className="font-medium">
        {model.auto_approved ? "系統核准" : "模型估計"}
        {model.probability !== null && (
          <span className="ml-1 font-normal text-muted-foreground">
            {model.auto_approved ? "模型估計" : ""}核准機率 <span className="tabular-nums">{formatProbability(model.probability)}</span>
          </span>
        )}
        {model.probability === null && !model.auto_approved && (
          <span className="ml-1 font-normal text-muted-foreground">沒有模型，照規則送簽</span>
        )}
      </p>
      {model.reasons.length > 0 && (
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-foreground/80">
          {model.reasons.map((line) => (
            <li key={line.text} className={cn(line.alert && "font-medium text-destructive")}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
