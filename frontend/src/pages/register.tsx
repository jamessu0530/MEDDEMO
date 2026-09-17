import { useState, type FormEvent } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Link, Navigate, useLocation, useNavigate } from "react-router"

import { register } from "@/api/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, useAuth } from "@/lib/auth"

// 後端要求至少 8 碼；這裡先擋一次，免得為了太短的密碼白跑一趟伺服器
const MIN_LENGTH = 8

/**
 * 建立帳號（照 flutterproject4 的註冊）：名字、Email、密碼，建好直接登入。
 * 自己建立的帳號是業務，名下沒有客戶，先看示範業務的客戶與路線。
 */
export function RegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to={session.user.role === "manager" ? "/manager" : "/"} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < MIN_LENGTH) return setError(`密碼至少要 ${MIN_LENGTH} 碼`)
    if (password !== confirm) return setError("兩次輸入的密碼不一樣")
    setBusy(true)
    setError(null)
    try {
      const result = await register(name.trim(), email.trim(), password)
      signIn(result)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from ?? "/", { replace: true })
    } catch (err) {
      // 409 是這個 Email 已經註冊過或是第三方登入開的帳號，後端的訊息會說要怎麼登入
      setError(err instanceof Error ? err.message : "連不上伺服器，請確認網路後再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <p className="text-xs text-muted-foreground">中化裕民 · 業務 AI 助理</p>
        <h1 className="mt-1 text-2xl font-semibold">建立帳號</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          建好就直接登入。新帳號先看示範業務的客戶與今日路線。
        </p>
      </header>

      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">名字</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            maxLength={32}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-12 px-3 text-base"
          />
          <p className="text-xs text-muted-foreground">2～32 個字，之後可以在帳號設定改。</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 px-3 text-base"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">密碼</Label>
          <div className="relative">
            <Input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 pr-13 pl-3 text-base"
            />
            <button
              type="button"
              aria-label={visible ? "隱藏密碼" : "顯示密碼"}
              onClick={() => setVisible((on) => !on)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-lg text-muted-foreground"
            >
              {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">至少 {MIN_LENGTH} 碼。</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">再輸入一次密碼</Label>
          <Input
            id="confirm"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="h-12 px-3 text-base"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="mt-2 h-12 w-full text-base"
          disabled={busy || !name.trim() || !email.trim() || !password || !confirm}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : "建立帳號"}
        </Button>
      </form>

      <p className="mt-6 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        已經有帳號了？
        <Link to="/login" state={location.state} className="inline-flex min-h-11 items-center font-medium text-primary">
          登入
        </Link>
      </p>
    </div>
  )
}
