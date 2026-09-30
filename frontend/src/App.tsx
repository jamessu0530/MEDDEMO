import { useEffect, type ReactNode } from "react"
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router"

import { fetchMe } from "@/api/auth"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Onboarding } from "@/components/onboarding"
import { canManage, homePath, refreshUser, useAuth } from "@/lib/auth"
import { uploadQueue } from "@/lib/offline-queue"
import { AdminPage } from "@/pages/admin"
import { AskPage } from "@/pages/ask"
import { ChannelPage } from "@/pages/channel"
import { ChannelThreadsPage } from "@/pages/channel-threads"
import { ChannelsPage } from "@/pages/channels"
import { CustomerPage } from "@/pages/customer"
import { CustomerPicker } from "@/pages/customer-picker"
import { DocumentPage } from "@/pages/document"
import { EscalationsPage } from "@/pages/escalations"
import { FirstWeekPage } from "@/pages/first-week"
import { OaFormPage } from "@/pages/oa-form"
import { OaFormsPage } from "@/pages/oa-forms"
import { GitHubCallbackPage } from "@/pages/github-callback"
import { LoginPage } from "@/pages/login"
import { PrivacyPage } from "@/pages/privacy"
import { PromotionsPage } from "@/pages/promotions"
import { RegisterPage } from "@/pages/register"
import { ManagerPage } from "@/pages/manager"
import { NegotiationPage } from "@/pages/negotiation"
import { QuotePage } from "@/pages/quote"
import { RecordVisit } from "@/pages/record-visit"
import { SettingsPage } from "@/pages/settings"
import { TodayPage } from "@/pages/today"
import { VisitPage } from "@/pages/visit"

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-3 p-4 pt-10">
      <Mascot state="think" size={96} className="self-center" />
      <Notice text="找不到這個頁面。" action={{ label: "回今日路線", onClick: () => navigate("/") }} />
    </div>
  )
}

/**
 * 沒登入就進不去（FR-12）：除了 /login 與 GitHub 登入的 callback，每一頁都要先有登入狀態，否則導去登入頁，
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

/** 首頁：業務是今日路線；主管與 IT 沒有自己的路線，各自進主管端與組織管理 */
function Home() {
  const session = useAuth()
  const home = session ? homePath(session.user.role) : "/"
  return home === "/" ? <TodayPage /> : <Navigate to={home} replace />
}

/** 限定角色的頁面；進不去的人（舊的連結、書籤）說明一下並給回首頁的路 */
function Restricted({ allowed, text, children }: { allowed: boolean; text: string; children: ReactNode }) {
  const session = useAuth()
  const navigate = useNavigate()
  if (session && !allowed) {
    return (
      <div className="p-4 pt-10">
        <Notice text={text} action={{ label: "回首頁", onClick: () => navigate("/", { replace: true }) }} />
      </div>
    )
  }
  return <>{children}</>
}

/** 主管端：主管與 IT 進得去 */
function ManagerOnly({ children }: { children: ReactNode }) {
  const session = useAuth()
  return (
    <Restricted allowed={Boolean(session && canManage(session.user.role))} text="主管端只有主管的帳號進得去，你的帳號是業務。">
      {children}
    </Restricted>
  )
}

/** 組織管理：只有 IT */
function ItOnly({ children }: { children: ReactNode }) {
  const session = useAuth()
  return (
    <Restricted allowed={session?.user.role === "it"} text="組織管理只有 IT 的帳號進得去。">
      {children}
    </Restricted>
  )
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
          <Route path="/register" element={<RegisterPage />} />
          {/* 隱私權政策不用登入就要看得到：Google 與 Facebook 審核時會直接打開這個網址 */}
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* GitHub 授權完導回來的頁面：登入流程也會走到，所以不能放在要登入的那一層裡 */}
          <Route path="/auth/github/callback" element={<GitHubCallbackPage />} />
          <Route element={<RequireAuth />}>
            {/* 首頁是今日路線；客戶清單移到 /customers，要自己挑一家時從底部分頁進去 */}
            <Route path="/" element={<Home />} />
            <Route path="/customers" element={<CustomerPicker />} />
            <Route path="/ask" element={<AskPage />} />
            {/* 頻道：業務、主管、IT 都進得去，看得到哪些頻道由後端依組織樹決定 */}
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:channelId" element={<ChannelPage />} />
            <Route path="/channels/:channelId/threads" element={<ChannelThreadsPage />} />
            <Route path="/promotions" element={<PromotionsPage />} />
            {/* 語音併進問答頁了，舊書籤與導覽說明還指得到這個網址 */}
            <Route path="/voice" element={<Navigate to="/ask" replace />} />
            <Route path="/customers/:customerId" element={<CustomerPage />} />
            <Route path="/customers/:customerId/negotiation" element={<NegotiationPage />} />
            <Route path="/customers/:customerId/quote" element={<QuotePage />} />
            <Route path="/customers/:customerId/record" element={<RecordVisit />} />
            <Route path="/visits/:visitId" element={<VisitPage />} />
            <Route path="/escalations" element={<EscalationsPage />} />
            <Route path="/oa/forms" element={<OaFormsPage />} />
            <Route path="/oa/forms/:formId" element={<OaFormPage />} />
            <Route
              path="/manager"
              element={
                <ManagerOnly>
                  <ManagerPage />
                </ManagerOnly>
              }
            />
            <Route
              path="/admin"
              element={
                <ItOnly>
                  <AdminPage />
                </ItOnly>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            {/* 新人第一週：業務帳號都打得開；必讀文件點開是 /documents/檔名 */}
            <Route path="/first-week" element={<FirstWeekPage />} />
            <Route path="/documents/:sourceName" element={<DocumentPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}
