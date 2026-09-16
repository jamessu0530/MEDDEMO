import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  FACEBOOK_SDK,
  GOOGLE_SDK,
  facebookLogin,
  renderGoogleButton,
  setGoogleHandler,
  startGitHub,
  useScript,
  type OAuthMode,
} from "@/lib/oauth"

/*
 * 登入頁與帳號設定共用的第三方按鈕。按下去之後拿到的憑證交給呼叫的頁面決定要「登入」還是「綁定」；
 * GitHub 是整頁導走，結果由 /auth/github/callback 處理，所以只需要知道這次是哪一種。
 */

/** SDK 載不下來時的說明：Email 登入不受影響，給一顆再試一次 */
function SdkFailed({ name, onRetry }: { name: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
      <p>
        {name} 登入元件載入失敗，可能是網路不穩，或被瀏覽器的廣告阻擋功能擋掉了。
      </p>
      <Button variant="outline" className="h-11 self-start px-4" onClick={onRetry}>
        再試一次
      </Button>
    </div>
  )
}

type GoogleButtonProps = {
  clientId: string
  // 登入頁用「使用 Google 帳戶登入」，綁定用「使用 Google 帳戶繼續」；文字由 GIS 依語系自己產生
  text: "signin_with" | "continue_with"
  onCredential: (credential: string) => void
}

/**
 * Google 的按鈕依品牌規範只能用 GIS 自己畫的那顆（放在 iframe 裡），不能換成自己的樣式，
 * 也沒辦法從別的按鈕觸發同一個流程；高度固定 40px，外層補到 48px 跟其他按鈕對齊。
 */
export function GoogleButton({ clientId, text, onCredential }: GoogleButtonProps) {
  const { status, retry } = useScript(GOOGLE_SDK, true)
  const container = useRef<HTMLDivElement>(null)
  const handle = useEffectEvent((credential: string) => onCredential(credential))

  useEffect(() => {
    if (status !== "ready" || !container.current) return
    setGoogleHandler((credential) => handle(credential))
    try {
      renderGoogleButton(container.current, clientId, text)
    } catch (err) {
      console.error(err)
    }
    return () => setGoogleHandler(null)
  }, [status, clientId, text])

  if (status === "error") return <SdkFailed name="Google" onRetry={retry} />
  return (
    <div className="relative flex min-h-12 w-full items-center justify-center">
      {status !== "ready" && (
        <Loader2 className="absolute size-5 animate-spin text-muted-foreground" aria-label="載入 Google 登入" />
      )}
      {/* 容器一開始就佔滿寬度：GIS 畫按鈕時照這個寬度決定按鈕多寬 */}
      <div ref={container} className="flex w-full max-w-100 justify-center" />
    </div>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  )
}

type GitHubButtonProps = {
  clientId: string
  mode: OAuthMode
  label: string
  className?: string
  disabled?: boolean
  onError: (message: string) => void
}

/** 記下 state 之後整頁導去 GitHub；不需要先載任何 SDK */
export function GitHubButton({ clientId, mode, label, className, disabled, onError }: GitHubButtonProps) {
  const [leaving, setLeaving] = useState(false)

  // 在 GitHub 頁面按上一頁回來時，瀏覽器可能直接還原離開前的畫面，按鈕會一直轉圈，要恢復可以按
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => event.persisted && setLeaving(false)
    window.addEventListener("pageshow", restore)
    return () => window.removeEventListener("pageshow", restore)
  }, [])

  function start() {
    try {
      setLeaving(true)
      startGitHub(clientId, mode)
    } catch (err) {
      setLeaving(false)
      onError(err instanceof Error ? err.message : "沒辦法前往 GitHub，請再試一次")
    }
  }

  return (
    <Button variant="outline" className={className} disabled={disabled || leaving} onClick={start}>
      {leaving ? <Loader2 className="size-5 animate-spin" /> : mode === "login" && <GitHubMark />}
      {label}
    </Button>
  )
}

type FacebookButtonProps = {
  appId: string
  label: string
  // 登入頁用 Facebook 品牌藍的大按鈕；帳號設定裡跟其他列一樣用外框小按鈕
  variant: "brand" | "outline"
  className?: string
  disabled?: boolean
  onToken: (accessToken: string) => void
  onError: (message: string) => void
}

/**
 * SDK 在畫面出現時就先載好：FB.login 必須在點擊當下直接呼叫，
 * 等按下去才開始下載的話，彈出視窗會被手機瀏覽器擋掉。
 */
export function FacebookButton({ appId, label, variant, className, disabled, onToken, onError }: FacebookButtonProps) {
  const { status, retry } = useScript(FACEBOOK_SDK, true)
  const [waiting, setWaiting] = useState(false)

  if (status === "error") return <SdkFailed name="Facebook" onRetry={retry} />

  function start() {
    setWaiting(true)
    facebookLogin(appId)
      .then((token) => {
        // 使用者自己把視窗關掉：什麼都不做，不必顯示錯誤
        if (token) onToken(token)
      })
      .catch((err) => {
        console.error(err)
        onError(
          location.protocol === "https:"
            ? "沒辦法開啟 Facebook 登入，請再試一次"
            : "Facebook 只允許在 https 網址登入，這個網址沒辦法使用"
        )
      })
      .finally(() => setWaiting(false))
  }

  const brand = variant === "brand"
  return (
    <Button
      variant={brand ? "default" : "outline"}
      className={cn(brand && "bg-[#1877F2] text-white hover:bg-[#1877F2]/90", className)}
      disabled={disabled || waiting || status !== "ready"}
      onClick={start}
    >
      {waiting || status !== "ready" ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        brand && <FacebookMark />
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
  provider: "google" | "github" | "facebook"
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
      variant={brand && provider === "facebook" ? "default" : "outline"}
      className={cn(
        brand && provider === "facebook" && "bg-[#1877F2] text-white hover:bg-[#1877F2]/90",
        brand && provider === "google" && "bg-white text-[#1f1f1f] hover:bg-white/90",
        className
      )}
      onClick={onNotReady}
    >
      {brand && provider === "google" && <GoogleMark />}
      {brand && provider === "github" && <GitHubMark />}
      {brand && provider === "facebook" && <FacebookMark />}
      {label}
    </Button>
  )
}

