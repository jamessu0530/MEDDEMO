import { NavLink } from "react-router"
import { canManage, useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

export function OaNav() {
  const user = useAuth()?.user
  const links = [
    { to: "/oa/apps", label: "我的應用" },
    { to: "/oa/forms", label: "我的申請單" },
    ...(user && canManage(user.role)
      ? [{ to: "/manager?view=oa", label: "我的批准" }]
      : []),
  ]
  return (
    <nav
      aria-label="OA 導覽"
      className="flex gap-1 overflow-x-auto border-b px-4"
    >
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end
          className={({ isActive }) =>
            cn(
              "shrink-0 border-b-2 px-4 py-3 text-sm",
              isActive
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground"
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
}
