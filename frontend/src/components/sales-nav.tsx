import { BadgePercent, ClipboardList, Pill, Target } from "@/components/icons"
import { cn } from "@/lib/utils"

export type SalesView = "orders" | "products" | "promotions" | "opportunities"

export function SalesNav({
  view,
  onChange,
}: {
  view: SalesView
  onChange: (view: SalesView) => void
}) {
  return (
    <nav
      aria-label="銷售分頁"
      className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
    >
      {(
        [
          { value: "orders", label: "訂單", icon: ClipboardList },
          { value: "opportunities", label: "潛在銷售", icon: Target },
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
            "flex min-h-11 min-w-max flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-sm font-semibold whitespace-nowrap sm:flex-row sm:gap-1.5 sm:py-1",
            view === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </button>
      ))}
    </nav>
  )
}
