import { useState } from "react"

import { switchDemoRole } from "@/api/auth"
import { homePath, signIn, type AuthUser, type Role } from "@/lib/auth"
import { cn } from "@/lib/utils"

const ROLES: { role: Role; label: string }[] = [
  { role: "sales", label: "業務" },
  { role: "manager", label: "主管" },
  { role: "it", label: "it" },
]

/** 伺服器開啟 Demo 時才出現；切換角色後重新載入，登入者仍是本人。 */
export function DemoRoleSwitcher({ user }: { user: AuthUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!user.demo) return null

  async function select(role: Role) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await switchDemoRole(role)
      signIn(result)
      window.location.replace(homePath(result.user.role))
    } catch (err) {
      setError(err instanceof Error ? err.message : "切換失敗，請再試一次")
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="身分切換"
      aria-busy={busy}
      className="border-b bg-primary/5 px-4 py-2.5"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="flex min-w-0 flex-wrap items-center gap-1.5"
          role="group"
          aria-label="選擇身分"
        >
          {ROLES.map(({ role, label }) => (
            <button
              key={role}
              type="button"
              aria-pressed={user.role === role}
              disabled={busy}
              onClick={() => void select(role)}
              className={cn(
                "min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-50",
                user.role === role
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
