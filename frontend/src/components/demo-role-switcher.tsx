import { useState } from "react"

import { switchDemoRole } from "@/api/auth"
import { homePath, signIn, type AuthUser, type Role } from "@/lib/auth"
import { cn } from "@/lib/utils"

const ROLES: { role: Role; label: string }[] = [
  { role: "sales", label: "業務" },
  { role: "manager", label: "主管" },
  { role: "it", label: "IT" },
]

/** 伺服器開啟 Demo 時才出現；換頁重新載入，清掉前一個身分的畫面、快取與即時連線。 */
export function DemoRoleSwitcher({ user }: { user: AuthUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!user.demo) return null

  async function select(role: Role | null) {
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
        <div className="min-w-0 basis-full text-xs leading-relaxed sm:flex-1 sm:basis-auto">
          <p className="font-semibold text-primary">身分切換</p>
          <p className="text-muted-foreground">
            {user.demo.role
              ? `目前：${user.name}（登入：${user.demo.account.name}）`
              : `登入帳號：${user.demo.account.name}`}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5"
          role="group"
          aria-label="選擇身分"
        >
          {ROLES.map(({ role, label }) => (
            <button
              key={role}
              type="button"
              aria-pressed={user.demo?.role === role}
              disabled={busy}
              onClick={() => void select(role)}
              className={cn(
                "min-h-11 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50",
                user.demo?.role === role
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
            >
              {label}
            </button>
          ))}
          {user.demo.role && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void select(null)}
              className="min-h-11 rounded-full px-2 text-xs font-semibold text-primary hover:bg-muted disabled:opacity-50"
            >
              回原帳號
            </button>
          )}
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
