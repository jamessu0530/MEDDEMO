import { BadgePercent, ClipboardList, Pill } from "@/components/icons"
import { cn } from "@/lib/utils"

export type SalesView = "orders" | "products" | "promotions"

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
      className="mt-3 flex gap-1 rounded-xl bg-muted p-1"
    >
      {(
        [
          { value: "orders", label: "訂單", icon: ClipboardList },
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
            "flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
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
