import { useRef, useState, type ChangeEvent } from "react"
import { Loader2 } from "@/components/icons"
import { Link } from "react-router"

import { removeMyAvatar, uploadAvatar } from "@/api/avatars"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { avatars, squarePhoto, useAvatarUrl, useMascotAvatar } from "@/lib/avatars"
import { useAuth } from "@/lib/auth"

/** 設定頁的「大頭貼」一段：拍照或從相簿選一張，從中間裁成正方形；也可以移除，回到名字縮寫 */
export function ProfilePhotoSection() {
  const user = useAuth()?.user
  const url = useAvatarUrl(user?.id ?? "")
  const mascot = useMascotAvatar(user?.id ?? "")
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!user) return null
  const userId = user.id

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清掉，同一張再選一次也會觸發
    event.target.value = ""
    if (!file || busy) return
    setBusy("upload")
    setError(null)
    setProgress(0)
    try {
      const { url: next } = await uploadAvatar(await squarePhoto(file), setProgress)
      avatars.update(userId, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "照片沒有換成功，請再試一次")
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function remove() {
    if (busy) return
    setBusy("remove")
    setError(null)
    try {
      await removeMyAvatar()
      avatars.update(userId, null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有移除成功，請再試一次")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">大頭貼</h2>
      <div className="flex items-center gap-4 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <UserAvatar id={user.id} name={user.name} size="lg" className="size-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {(url || mascot) && <p className="text-xs leading-relaxed text-muted-foreground">頭像對全公司顯示。</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy === "upload" ? <Loader2 className="size-5 animate-spin" /> : url ? "換照片" : "上傳照片"}
            </Button>
            {(url || mascot) && (
              <Button variant="ghost" className="h-11 px-4" disabled={busy !== null} onClick={() => void remove()}>
                {busy === "remove" ? <Loader2 className="size-5 animate-spin" /> : "移除"}
              </Button>
            )}
          </div>
        </div>
        {/* image/*：手機上可以選拍照或相簿 */}
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event) => void pick(event)} />
      </div>
      <Link to="/mascots" className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 bg-accent px-4 text-sm font-medium text-primary">熊熊衣櫃</Link>
      {progress !== null && (
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="上傳進度"
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
          {error}
        </p>
      )}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        照片會裁成正方形，並移除拍攝資訊。
      </p>
    </section>
  )
}
