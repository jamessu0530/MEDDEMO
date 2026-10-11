import { BadgePercent, Pill } from "lucide-react"
import { cn } from "@/lib/utils"

export type CatalogView = "products" | "promotions"

/** 在同一頁切換內容，商品搜尋與促銷月份都保留。 */
export function CatalogNav({
  view,
  onChange,
}: {
  view: CatalogView
  onChange: (view: CatalogView) => void
}) {
  return (
    <nav
      aria-label="商品與促銷"
      className="mt-3 flex gap-1 rounded-xl bg-muted p-1"
    >
      {(
        [
          { value: "products", label: "商品", icon: Pill },
          { value: "promotions", label: "促銷", icon: BadgePercent },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
            view === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </nav>
  )
}
