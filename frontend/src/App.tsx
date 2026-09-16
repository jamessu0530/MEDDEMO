import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router"

import { fetchMe } from "@/api/auth"
import { Notice } from "@/components/notice"
import { Onboarding } from "@/components/onboarding"
import { refreshUser, useAuth } from "@/lib/auth"
import { uploadQueue } from "@/lib/offline-queue"
import { AskPage } from "@/pages/ask"
import { CustomerPage } from "@/pages/customer"
import { CustomerPicker } from "@/pages/customer-picker"
import { EscalationsPage } from "@/pages/escalations"
import { LoginPage } from "@/pages/login"
import { ManagerPage } from "@/pages/manager"
import { NegotiationPage } from "@/pages/negotiation"
import { RecordVisit } from "@/pages/record-visit"
import { SettingsPage } from "@/pages/settings"
import { TodayPage } from "@/pages/today"
import { VisitPage } from "@/pages/visit"

// 語音問答連同 Gemini SDK 另外打包，打開這一頁才下載，其他頁面不必多等
const VoicePage = lazy(() => import("@/pages/voice"))

function PageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="p-4">
      <Notice text="找不到這個頁面。" action={{ label: "回今日路線", onClick: () => navigate("/") }} />
    </div>
  )
}

/**
 * 沒登入就進不去（FR-12）：除了 /login，每一頁都要先有登入狀態，否則導去登入頁，
 * 登入成功後再回到本來要看的那一頁。401（token 過期、在別的裝置登入）由 api/client.ts 清掉登入狀態，
 * 這裡看到沒登入就會自動把人送回登入頁。
 */
function RequireAuth() {
  const session = useAuth()
  const location = useLocation()
  const signedIn = Boolean(session)

  // 一打開就確認這組 token 還有效，順便更新姓名、區域；401 會由 api/client.ts 登出
  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    fetchMe(controller.signal)
      .then(refreshUser)
      .catch(() => {
        // 沒訊號時照舊用這支手機存的身分，之後任何一個請求收到 401 一樣會導回登入頁
      })
    return () => controller.abort()
  }, [signedIn])

  if (!session) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />

  return (
    <>
      <Outlet />
      {/* FR-11：第一次打開時說明三個主要操作，登入之後才顯示 */}
      <Onboarding />
    </>
  )
}

/** 首頁：業務是今日路線；主管沒有自己的路線，直接進主管端 */
function Home() {
  const session = useAuth()
  return session?.user.role === "manager" ? <Navigate to="/manager" replace /> : <TodayPage />
}

/** 主管端只有主管進得去；業務點到（舊的連結、書籤）說明一下並給回首頁的路 */
function ManagerOnly({ children }: { children: ReactNode }) {
  const session = useAuth()
  const navigate = useNavigate()
  if (session && session.user.role !== "manager") {
    return (
      <div className="p-4 pt-10">
        <Notice
          text="主管端只有主管的帳號進得去，你的帳號是業務。"
          action={{ label: "回今日路線", onClick: () => navigate("/", { replace: true }) }}
        />
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  // 手機裡還沒送出的錄音：一打開 App 就開始自動重送，不管停在哪一頁（FR-4.3）
  useEffect(() => uploadQueue.start(), [])

  return (
    <BrowserRouter>
      {/* 以手機為主：在寬螢幕上置中，維持手機的寬度 */}
      <div className="mx-auto min-h-svh max-w-md bg-background">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            {/* 首頁是今日路線；客戶清單移到 /customers，要自己挑一家時從底部分頁進去 */}
            <Route path="/" element={<Home />} />
            <Route path="/customers" element={<CustomerPicker />} />
            <Route path="/ask" element={<AskPage />} />
            <Route
              path="/voice"
              element={
                <Suspense fallback={<PageLoading />}>
                  <VoicePage />
                </Suspense>
              }
            />
            <Route path="/customers/:customerId" element={<CustomerPage />} />
            <Route path="/customers/:customerId/negotiation" element={<NegotiationPage />} />
            <Route path="/customers/:customerId/record" element={<RecordVisit />} />
            <Route path="/visits/:visitId" element={<VisitPage />} />
            <Route path="/escalations" element={<EscalationsPage />} />
            <Route
              path="/manager"
              element={
                <ManagerOnly>
                  <ManagerPage />
                </ManagerOnly>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}
