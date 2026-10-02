import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { ChevronRight, Loader2, LogOut } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router"

import {
  changePassword,
  deleteAccount,
  linkProvider,
  signOutSession,
  unlinkProvider,
  updateProfile,
  type OAuthCredential,
  type OAuthProviders,
} from "@/api/auth"
import { MyStatusSection } from "@/components/my-status"
import { ProfilePhotoSection } from "@/components/profile-photo"
import { FacebookButton, NotReadyButton, RedirectButton } from "@/components/oauth-buttons"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changeSkin, playInk } from "@/ink/ink"
import { canManage, homePath, refreshUser, signIn, useAuth, type AuthUser } from "@/lib/auth"
import { PROVIDER_LABEL, useProviders, type OAuthProvider } from "@/lib/oauth"
import { openGuide } from "@/lib/onboarding"
import { useSkin, type Skin } from "@/lib/skin"
import { setTextSize, useTextSize, type TextSize } from "@/lib/text-size"
import { cn } from "@/lib/utils"

const ROLE_LABEL = { sales: "業務", manager: "主管", it: "IT" } as const
// 後端要求至少 8 碼；這裡先擋一次，免得為了太短的密碼白跑一趟伺服器
const MIN_LENGTH = 8

const PROVIDERS: OAuthProvider[] = ["google", "github", "facebook"]
// 跟後端 services/auth.py 的名字規則一致；這裡先擋，錯誤訊息不必等伺服器
const NAME_MIN = 2
const NAME_MAX = 32

// 色票是固定的顏色，不跟著目前的配色變：要讓人看得出另一個選項長什麼樣子
const SKINS: { id: Skin; label: string; swatch: string }[] = [
  { id: "light", label: "淺色", swatch: "#9B51E0" },
  { id: "dark", label: "深色", swatch: "linear-gradient(90deg, #141414 0 50%, #8C8C89 50%)" },
]

/**
 * 配色：淺色（紫）或深色（黑灰），記在這支手機裡。首頁的頁首也有一顆切換鈕（components/skin-toggle.tsx）。
 * 換的時候用噴漆把整個畫面染成新的顏色（ink/ink.ts 的 changeSkin）
 */
function SkinPicker() {
  const skin = useSkin()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">配色</h2>
      <div role="radiogroup" aria-label="配色" className="grid grid-cols-2 gap-2">
        {SKINS.map(({ id, label, swatch }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={skin === id}
            onClick={() => changeSkin(id)}
            className={cn(
              "flex h-12 items-center justify-center gap-2 rounded-xl border-2 bg-card text-sm font-medium shadow-lip press",
              skin === id && "border-primary ring-1 ring-primary"
            )}
          >
            <span aria-hidden className="size-4 rounded-full border" style={{ background: swatch }} />
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}

// 每個按鈕用自己的大小寫一個「字」，選之前就看得出差多少（16px 乘上 index.css 的倍率）。
// 用像素寫死，不跟著目前的設定放大，三個才比得出差別
const TEXT_SIZES: { id: TextSize; label: string; sample: number }[] = [
  { id: "standard", label: "標準", sample: 16 },
  { id: "large", label: "大", sample: 18 },
  { id: "xlarge", label: "特大", sample: 20 },
]

/** 字體大小：整頁一起放大，記在這支手機裡（lib/text-size.ts） */
function TextSizePicker() {
  const size = useTextSize()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">字體大小</h2>
      <div role="radiogroup" aria-label="字體大小" className="grid grid-cols-3 gap-2">
        {TEXT_SIZES.map(({ id, label, sample }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={size === id}
            onClick={() => setTextSize(id)}
            className={cn(
              "flex h-14 items-center justify-center gap-1.5 rounded-xl border-2 bg-card text-sm font-medium shadow-lip press",
              size === id && "border-primary ring-1 ring-primary"
            )}
          >
            <span aria-hidden style={{ fontSize: sample }}>
              字
            </span>
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}

/** 名字：自己開的帳號可以改（照 flutterproject4 的改暱稱）；公司帳號只顯示 */
function NameEditor({ user }: { user: AuthUser }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(user.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!editing)
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium break-all">{user.name}</p>
          {saved && <p className="mt-0.5 text-xs text-primary">名字已更新</p>}
        </div>
        {user.can_rename && (
          <Button
            variant="outline"
            className="h-11 shrink-0 px-4"
            onClick={() => {
              setDraft(user.name)
              setError(null)
              setSaved(false)
              setEditing(true)
            }}
          >
            修改名字
          </Button>
        )}
      </div>
    )

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.trim().replace(/\s+/g, " ")
    if (name.length < NAME_MIN || name.length > NAME_MAX) return setError(`名字要 ${NAME_MIN}～${NAME_MAX} 個字`)
    if (name === user.name) return setEditing(false)
    setBusy(true)
    setError(null)
    try {
      refreshUser(await updateProfile(name))
      setSaved(true)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "名字沒有改成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={save}>
      <Label htmlFor="display-name">名字</Label>
      <Input
        id="display-name"
        autoComplete="name"
        autoFocus
        maxLength={NAME_MAX}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="h-12 px-3 text-base"
      />
      <p className="text-xs text-muted-foreground">
        {NAME_MIN}～{NAME_MAX} 個字。
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : "儲存"}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
    </form>
  )
}

/**
 * 綁定的登入方式：公司給的 Email 帳號可以在這裡綁第三方帳號，之後在登入頁用它登入就回到這個帳號。
 * 三家一律列出來；伺服器還沒設定的那家按「綁定」說明還沒開放。
 */
function LinkedAccounts({ user, providers }: { user: AuthUser; providers: OAuthProviders }) {
  const location = useLocation()
  const navigate = useNavigate()
  // Google、GitHub 綁定是整頁導走再回來，callback 頁用 location.state 告訴這裡成功了
  const [done, setDone] = useState<string | null>(() => {
    const linked = (location.state as { linked?: OAuthProvider } | null)?.linked
    return linked ? `已綁定 ${PROVIDER_LABEL[linked]}，下次在登入頁可以直接用它登入。` : null
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<OAuthProvider | null>(null)
  // 對話框關閉時有淡出動畫，provider 留著不清，標題才不會在淡出途中變成空白
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState<OAuthProvider>("google")

  // 訊息已經拿到了，把 location.state 清掉，重新整理這一頁才不會又顯示一次
  useEffect(() => {
    if ((location.state as { linked?: string } | null)?.linked) navigate(".", { replace: true, state: null })
  }, [location.state, navigate])


  async function link(credential: OAuthCredential) {
    if (busy) return
    setBusy(credential.provider)
    setError(null)
    setDone(null)
    try {
      refreshUser(await linkProvider(credential))
      setDone(`已綁定 ${PROVIDER_LABEL[credential.provider]}，下次在登入頁可以直接用它登入。`)
    } catch (err) {
      // 409 是這個第三方帳號已經綁在別人身上，後端的訊息直接顯示
      setError(err instanceof Error ? err.message : "綁定沒有成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  async function unlink(provider: OAuthProvider) {
    setConfirmOpen(false)
    if (busy) return
    setBusy(provider)
    setError(null)
    setDone(null)
    try {
      refreshUser(await unlinkProvider(provider))
      setDone(`已解除 ${PROVIDER_LABEL[provider]} 綁定。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除綁定沒有成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  function showError(message: string) {
    setDone(null)
    setError(message)
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">綁定的登入方式</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          綁定之後，登入頁可以直接用這些帳號登入；Email 密碼一樣可以用。
        </p>
      </div>

      <ul className="divide-y rounded-2xl border-2 bg-card shadow-lip">
        {PROVIDERS.map((provider) => {
          const linked = user.linked?.find((account) => account.provider === provider)
          const label = PROVIDER_LABEL[provider]
          // 這支手機存的舊身分還沒有 linked 欄位：等 /api/auth/me 回來再給按鈕，免得把已綁定的顯示成未綁定
          const loading = user.linked === undefined
          let status = "尚未綁定"
          if (loading) status = "讀取中…"
          else if (linked) status = linked.email ?? "已綁定"

          let action: ReactNode
          if (loading) action = null
          else if (busy === provider) action = <Loader2 className="size-5 animate-spin text-muted-foreground" />
          else if (linked)
            action = (
              <Button
                variant="outline"
                className="h-11 px-4"
                disabled={busy !== null}
                onClick={() => {
                  setConfirming(provider)
                  setConfirmOpen(true)
                }}
              >
                解除綁定
              </Button>
            )
          else if ((provider === "google" || provider === "github") && providers[provider])
            action = (
              <RedirectButton
                provider={provider}
                clientId={providers[provider].client_id}
                mode="link"
                label="綁定"
                className="h-11 px-4"
                disabled={busy !== null}
                onError={showError}
              />
            )
          else if (provider === "facebook" && providers.facebook)
            action = (
              <FacebookButton
                appId={providers.facebook.app_id}
                label="綁定"
                variant="outline"
                className="h-11 px-4"
                disabled={busy !== null}
                onToken={(token) => void link({ provider: "facebook", body: { access_token: token } })}
                onError={showError}
              />
            )
          else
            action = (
              <NotReadyButton
                provider={provider}
                label="綁定"
                variant="outline"
                className="h-11 px-4"
                onNotReady={() => showError(`${label} 綁定還沒開放。`)}
              />
            )

          return (
            <li key={provider} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-0.5 text-xs break-all text-muted-foreground">{status}</p>
              </div>
              {action}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-primary">
          {done}
        </p>
      )}

      {/* 解除前確認：按錯的話要重新走一次第三方授權才綁得回來 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>解除 {PROVIDER_LABEL[confirming]} 綁定？</DialogTitle>
            <DialogDescription>
              解除後就不能再用這個 {PROVIDER_LABEL[confirming]} 帳號登入，Email 密碼登入不受影響；之後想用可以再綁定一次。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" className="h-11" onClick={() => void unlink(confirming)}>
              解除綁定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** 刪除帳號：只有自己開的帳號看得到（公司帳號是示範資料）。隱私權政策寫的刪除方式就是這顆 */
function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
    } catch (err) {
      setError(err instanceof Error ? err.message : "帳號沒有刪除成功，請再試一次")
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <Button variant="ghost" className="h-11 w-full text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        刪除帳號
      </Button>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>刪除帳號？</DialogTitle>
            <DialogDescription>
              會刪掉這個帳號、綁定的第三方登入、你問過的問題與轉給主管的提問，以及你對方法卡按的「有幫上／沒幫上」，刪了不能復原。你開的報價草稿是客戶的交易紀錄，會留著，但不再記是誰開的。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" className="h-11" disabled={busy} onClick={() => void remove()}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : "刪除帳號"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** 帳號設定：看自己的身分、綁定第三方登入、改密碼、登出、再看一次使用說明。業務從今日路線標頭的姓名進來，主管與 IT 從各自首頁的標頭進來 */
export function SettingsPage() {
  const session = useAuth()
  const user = session?.user
  const providers = useProviders()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!user) return null // 沒登入進不來（App.tsx 會導去登入頁），這行只是讓型別成立

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setDone(false)
    if (next.length < MIN_LENGTH) {
      setError(`新密碼至少要 ${MIN_LENGTH} 碼。`)
      return
    }
    if (next !== confirm) {
      setError("兩次輸入的新密碼不一樣，請再確認一次。")
      return
    }
    setBusy(true)
    try {
      // 後端改完密碼會把舊 token 作廢，順手發一張新的：換掉本機存的，這支手機就不必重新登入
      signIn(await changePassword(current, next))
      setCurrent("")
      setNext("")
      setConfirm("")
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "改密碼沒有成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="帳號設定" backTo={homePath(user.role)} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
          <NameEditor user={user} />
          <p className="mt-1 text-sm text-muted-foreground">
            {user.region} · {ROLE_LABEL[user.role]}
          </p>
          {user.email && <p className="mt-0.5 text-sm break-all text-muted-foreground">{user.email}</p>}
          {user.acting_as && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              這是自己建立的帳號，名下沒有客戶，今日路線與客戶看的是示範業務{user.acting_as.name}的資料。
            </p>
          )}
        </section>

        <ProfilePhotoSection />
        <MyStatusSection />

        <Link
          to={canManage(user.role) ? "/manager?view=oa" : "/oa/forms"}
          className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 shadow-lip press"
        >
          <span className="text-sm font-medium">{canManage(user.role) ? "OA 簽核匣" : "我的申請單"}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>

        {/* 業務帳號隨時可以回去看；過了新人期首頁不再顯示入口卡，這裡是唯一的入口 */}
        {user.role === "sales" && (
          <Link to="/first-week" className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 shadow-lip press">
            <span className="text-sm font-medium">新人第一週</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        {/* 業務自己的排序習慣；調整行程的頁首也進得去 */}
        {user.role === "sales" && (
          <Link
            to="/route/habits"
            state={{ from: "/settings" }}
            className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 shadow-lip press"
          >
            <span className="text-sm font-medium">我的排序習慣</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        {user.role === "sales" && (
          // 首頁的頁首放不下了，使用說明從這裡（和客戶清單的頁首）再打開；只講業務的操作，主管端也不顯示導覽
          <button
            type="button"
            onClick={openGuide}
            className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 text-left shadow-lip press"
          >
            <span className="text-sm font-medium">看使用說明</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        )}

        <SkinPicker />
        <TextSizePicker />

        {providers && <LinkedAccounts user={user} providers={providers} />}

        {user.has_password === false ? (
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">密碼</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">這個帳號用第三方登入，沒有密碼。</p>
          </section>
        ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">改密碼</h2>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">目前的密碼</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className="h-12 px-3 text-base"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">新密碼</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(event) => setNext(event.target.value)}
                className="h-12 px-3 text-base"
              />
              <p className="text-xs text-muted-foreground">至少 {MIN_LENGTH} 碼。</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">再輸入一次新密碼</Label>
              <Input
                id="confirm-password"
                type="password"
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
            {done && (
              <p role="status" className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-primary">
                密碼已更新。這支手機可以繼續用，其他裝置上的登入已經失效，下次請用新的密碼。
              </p>
            )}

            <Button type="submit" className="h-12 w-full text-base" disabled={busy || !current || !next || !confirm}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : "更新密碼"}
            </Button>
          </form>
        </section>
        )}

        {/* 等墨蓋滿才登出：先登出的話這一頁會先空掉，墨蓋上來的是一片空白 */}
        <Button variant="outline" className="h-12 w-full gap-2 text-base" onClick={() => playInk("splat", signOutSession)}>
          <LogOut className="size-5" />
          登出
        </Button>

        {user.can_rename && <DeleteAccount />}

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">
            隱私權政策
          </Link>
        </p>
      </main>
    </div>
  )
}
