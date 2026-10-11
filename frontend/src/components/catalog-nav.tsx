import { BadgePercent, Pill } from "lucide-react"
import { NavLink } from "react-router"

import { cn } from "@/lib/utils"

/** 商品與促銷的共同入口，手機與電腦都可以直接切換。 */
export function CatalogNav() {
  return (
    <nav
      aria-label="商品與促銷"
      className="mt-3 flex gap-1 rounded-xl bg-muted p-1"
    >
      {[
        { to: "/products", label: "商品", icon: Pill },
        { to: "/promotions", label: "促銷", icon: BadgePercent },
      ].map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
