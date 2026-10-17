import { useEffect, useState } from "react"
import { Loader2 } from "@/components/icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PROVIDER_LABEL,
  startOAuthRedirect,
  type OAuthMode,
  type RedirectProvider,
} from "@/lib/oauth"

/*
 * 登入頁與帳號設定共用的第三方按鈕。Google、GitHub 是整頁導走，結果由 /auth/<provider>/callback 處理，
 * 所以只需要知道這次是「登入」還是「綁定」。
 */

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}

type RedirectButtonProps = {
  provider: RedirectProvider
  clientId: string
  mode: OAuthMode
  label: string
  className?: string
  disabled?: boolean
  // 登入完要回去的那一頁（被擋下來之前要去的）
  from?: string
  onError: (message: string) => void
}

/**
 * 記下 state 之後整頁導去 Google 或 GitHub 授權；不需要先載任何 SDK，也不開彈出視窗。
 * 登入頁用各家品牌樣式（Google 白底加 G 標誌）的大按鈕；帳號設定裡跟其他列一樣用外框小按鈕。
 */
export function RedirectButton({ provider, clientId, mode, label, className, disabled, from, onError }: RedirectButtonProps) {
  const [leaving, setLeaving] = useState(false)

  // 在授權頁按上一頁回來時，瀏覽器可能直接還原離開前的畫面，按鈕會一直轉圈，要恢復可以按
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => event.persisted && setLeaving(false)
    window.addEventListener("pageshow", restore)
    return () => window.removeEventListener("pageshow", restore)
  }, [])

  function start() {
    try {
      setLeaving(true)
      startOAuthRedirect(provider, clientId, mode, from)
    } catch (err) {
      setLeaving(false)
      onError(err instanceof Error ? err.message : `沒辦法前往 ${PROVIDER_LABEL[provider]}，請再試一次`)
    }
  }

  const brand = mode === "login"
  return (
    <Button
      variant="outline"
      className={cn(brand && provider === "google" && "bg-white text-[#1f1f1f] hover:bg-white/90", className)}
      disabled={disabled || leaving}
      onClick={start}
    >
      {leaving ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        brand && (provider === "google" ? <GoogleMark /> : <GitHubMark />)
      )}
      {label}
    </Button>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-5">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

type NotReadyButtonProps = {
  provider: RedirectProvider
  label: string
  // 登入頁用各家品牌樣式的大按鈕；帳號設定裡跟其他列一樣用外框小按鈕
  variant: "brand" | "outline"
  className?: string
  onNotReady: () => void
}

/**
 * 伺服器還沒設定這一家（GitHub Secrets 還沒填金鑰）時的按鈕：畫面照樣排出來，按下去說明還沒開放。
 * 金鑰一設好，/api/auth/providers 回傳那一家的 id，就換成上面真的按鈕，前端不必再改。
 */
export function NotReadyButton({ provider, label, variant, className, onNotReady }: NotReadyButtonProps) {
  const brand = variant === "brand"
  return (
    <Button
      variant="outline"
      className={cn(
        brand && provider === "google" && "bg-white text-[#1f1f1f] hover:bg-white/90",
        className
      )}
      onClick={onNotReady}
    >
      {brand && provider === "google" && <GoogleMark />}
      {brand && provider === "github" && <GitHubMark />}
      {label}
    </Button>
  )
}

