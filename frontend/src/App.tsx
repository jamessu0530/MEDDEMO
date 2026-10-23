import { Activity, useEffect, useState, type ReactNode } from "react"
import { createBrowserRouter, Navigate, Outlet, Route, useLocation, useNavigate, useParams } from "react-router"
import { RouterProvider } from "react-router/dom"

import { fetchMe } from "@/api/auth"
import { AppShell } from "@/components/app-shell"
import { CompletionCelebrationHost } from "@/components/completion-celebration"
import { Assistant } from "@/components/ask/assistant"
import { AssistantTaskNavigation } from "@/components/ask/assistant-task-navigation"
import { AssistantVoiceHost } from "@/components/ask/assistant-voice-host"
import { ConversationHistoryPage } from "@/pages/conversation-history"
import { openAssistant } from "@/ask/assistant-window"
import { openAssistantVoice } from "@/ask/assistant-voice"
import { InkOverlay, InkRoutes } from "@/components/ink-transition"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Onboarding } from "@/components/onboarding"
import { UiDemoOverlay } from "@/components/ui-demo/overlay"
import { canManage, homePath, refreshUser, useAuth } from "@/lib/auth"
import { uploadQueue } from "@/lib/offline-queue"
import { clearAvatars, loadAvatars } from "@/lib/avatars"
import { clearPreferences, loadPreferences } from "@/lib/preferences"
import { clearMyPresence, loadMyPresence } from "@/lib/presence"
import { realtime } from "@/lib/realtime"
import { trimPath } from "@/lib/desktop-layout"
import { useIsDesktop } from "@/lib/use-media-query"
import { useKeyboardViewport } from "@/lib/use-keyboard-viewport"
import { AdminPage } from "@/pages/admin"
import { CalendarPage } from "@/pages/calendar"
import { CalendarReminderHost } from "@/components/calendar/reminder-host"
import { ChannelPage } from "@/pages/channel"
import { ChannelThreadsPage } from "@/pages/channel-threads"
import { ChannelsPage } from "@/pages/channels"
import { ChannelSearchPage } from "@/pages/channel-search"
import { ContractPage } from "@/pages/contract"
import { CustomerPage } from "@/pages/customer"
import { CustomerPicker } from "@/pages/customer-picker"
import { OrdersPage } from "@/pages/orders"
import { OrderPage, PracticeOrderPage } from "@/pages/order"
import { DocumentPage } from "@/pages/document"
import { FirstWeekPage } from "@/pages/first-week"
import { LearningLessonPage } from "@/pages/learning-lesson"
import { ProductLearningPage } from "@/pages/product-learning"
import { OaFormPage } from "@/pages/oa-form"
import { OaFormsPage } from "@/pages/oa-forms"
import { OaAppsPage } from "@/pages/oa-apps"
import { OaEditorPage } from "@/pages/oa-editor"
import { OAuthCallbackPage } from "@/pages/oauth-callback"
import { LoginPage } from "@/pages/login"
import { MePage } from "@/pages/me"
import { MascotsPage } from "@/pages/mascots"
import { PrivacyPage } from "@/pages/privacy"
import { CatalogPage } from "@/pages/catalog"
import { RidesPage } from "@/pages/rides"
import { RegisterPage } from "@/pages/register"
import { ReportsPage } from "@/pages/reports"
import { SalesPage } from "@/pages/sales"
import { ManagerPage } from "@/pages/manager"
import { MethodsPage } from "@/pages/methods"
import { NegotiationPage } from "@/pages/negotiation"
import { QuotePage } from "@/pages/quote"
import { RecordVisit } from "@/pages/record-visit"
import { RouteAddPage } from "@/pages/route-add"
import { RouteEditPage } from "@/pages/route-edit"
import { RouteHabitsPage } from "@/pages/route-habits"
import { SettingsPage } from "@/pages/settings"
import { TodayPage } from "@/pages/today"
import { VisitPage } from "@/pages/visit"

/** 頻道：手機上 /channels 是兩欄、/channels/:id 是對話頁；電腦版兩個網址都是四欄那一頁。
 * 兩條路由用同一個元件，在電腦版從清單換到某個對話時四欄不會整個重新掛載 */
function ChannelsEntry() {
  const { channelId } = useParams()
  const desktop = useIsDesktop()
  return channelId === undefined || desktop ? <ChannelsPage /> : <ChannelPage />
}

function SalesEntry({ newOrder = false }: { newOrder?: boolean }) {
  return useAuth()?.user.role === "sales" ? <SalesPage newOrder={newOrder} /> : <OrdersPage newOrder={newOrder} />
}

/** 舊商品連結仍可使用，業務統一進銷售分頁；主管保留原本的型錄入口。 */
function CatalogEntry() {
  const session = useAuth()
  const { search } = useLocation()
  if (session?.user.role !== "sales") return <CatalogPage />
  const params = new URLSearchParams(search)
  params.set("view", params.get("view") === "promotions" ? "promotions" : "products")
  return <Navigate to={`/orders?${params}`} replace />
}

/** 沒登入的頁：電腦版也照手機的寬度置中 */
function PhoneColumn() {
  return (
    <div data-ui-demo-page className="pb-[var(--page-assistant-dock-space,5rem)] lg:mx-auto lg:max-w-md">
      <Outlet />
    </div>
  )
}

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-3 p-4 pt-10">
      <Mascot state="think" size={96} className="self-center" />
      <Notice text="找不到這個頁面。" action={{ label: "回首頁", onClick: () => navigate("/") }} />
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
  const token = session?.token

  // 登入後連上 WebSocket（在線狀態與新訊息通知，lib/realtime.ts）；換了 token（改過密碼、換人登入）就重連
  useEffect(() => {
    if (!token) return
    realtime.start()
    void loadMyPresence()
    // 連上 WebSocket 時會再拿一次（resync）；先拿，連不上的時候也看得到大家的照片
    void loadAvatars()
    // 配色與字體大小跟著帳號：換了手機登入，一進來就換成這個帳號選的
    loadPreferences()
    return () => {
      realtime.stop()
      clearMyPresence()
      clearAvatars()
      clearPreferences()
    }
  }, [token])

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
      <AppShell user={session.user}>
        <ReportSession key={session.user.id} />
        <Outlet />
      </AppShell>
      <CalendarReminderHost key={`calendar-${session.user.id}`} />
      <CompletionCelebrationHost key={`completion-${session.user.id}`} />
      {/* FR-11：第一次打開時說明三個主要操作，登入之後才顯示 */}
      <Onboarding />
    </>
  )
}

/** 暫時去其他頁時保留整個報表工作區；隱藏時暫停訂閱、刷新及對話框。 */
function ReportSession() {
  const { pathname } = useLocation()
  const active = trimPath(pathname) === "/reports"
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  if (!visited) return null
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <ReportsPage />
    </Activity>
  )
}

/** 首頁：業務進銷售；主管與 IT 各自進主管端與組織管理 */
function Home() {
  const session = useAuth()
  return <Navigate to={session ? homePath(session.user.role) : "/login"} replace />
}

/** 舊書籤仍會打開助理，問答不再是獨立頁面。 */
function AssistantEntry({ voice = false }: { voice?: boolean }) {
  useEffect(() => {
    if (voice) openAssistantVoice()
    else openAssistant()
  }, [voice])
  return <Home />
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
  const [router] = useState(() => createBrowserRouter([{ path: "*", element: <ApplicationRoutes /> }]))
  return <RouterProvider router={router} />
}

function ApplicationRoutes() {
  useKeyboardViewport()
  const session = useAuth()
  return (
    <>
      {/* 以手機為主：手機與平板維持手機的寬度置中；電腦版（≥1024px）登入後的頁由 AppShell 排，沒登入的頁照舊置中 */}
      <div className="mx-auto min-h-svh max-w-md bg-background lg:max-w-none">
        {/* 換頁時用墨蓋過去再露出來（components/ink-transition.tsx）；路由的寫法跟 <Routes> 一樣 */}
        <InkRoutes>
          <Route element={<PhoneColumn />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* 隱私權政策不用登入就要看得到：Google 審核時會直接打開這個網址 */}
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* Google、GitHub 授權完導回來的頁面：登入流程也會走到，所以不能放在要登入的那一層裡 */}
            <Route path="/auth/github/callback" element={<OAuthCallbackPage provider="github" />} />
            <Route path="/auth/google/callback" element={<OAuthCallbackPage provider="google" />} />
          </Route>
          <Route element={<RequireAuth />}>
            {/* 業務首頁是銷售，預設訂單分頁；今日路線獨立放在第二個分頁 /route */}
            <Route path="/" element={<Home />} />
            <Route path="/customers" element={<CustomerPicker />} />
            <Route path="/orders" element={<SalesEntry />} />
            <Route path="/orders/new" element={<SalesEntry newOrder />} />
            <Route path="/orders/demo" element={<PracticeOrderPage />} />
            <Route path="/orders/:orderId" element={<OrderPage />} />
            <Route path="/route" element={<TodayPage />} />
            {/* 調整今天的行程（清單）、加一站、我的排序習慣：只有業務有自己的行程，主管打開會看到後端的說明 */}
            <Route path="/route/edit" element={<RouteEditPage />} />
            <Route path="/route/edit/add" element={<RouteAddPage />} />
            <Route path="/route/habits" element={<RouteHabitsPage />} />
            <Route path="/ask" element={<AssistantEntry />} />
            <Route path="/calendar" element={<CalendarPage />} />
            {/* 頻道：業務、主管、IT 都進得去，看得到哪些頻道由後端依組織樹決定 */}
            <Route path="/channels" element={<ChannelsEntry />} />
            <Route path="/channels/search" element={<ChannelSearchPage />} />
            <Route path="/channels/:channelId" element={<ChannelsEntry />} />
            <Route path="/channels/:channelId/threads" element={<ChannelThreadsPage />} />
            <Route path="/products" element={<CatalogEntry />} />
            <Route path="/promotions" element={<Navigate to="/products?view=promotions" replace />} />
            {/* 方法卡：主管寫的做法，登入的人都看得到 */}
            <Route path="/methods" element={<MethodsPage />} />
            {/* 座騎圖鑑：熊熊滾騎過的座騎；主管與 IT 打開會看到後端的說明 */}
            <Route path="/rides" element={<RidesPage />} />
            <Route path="/me" element={<MePage />} />
            <Route path="/conversations" element={<ConversationHistoryPage />} />
            <Route path="/mascots" element={<MascotsPage />} />
            {/* 工作區由 RequireAuth 保留，換頁回來不會重新建立。 */}
            <Route path="/reports" element={null} />
            {/* 語音書籤直接啟動全站語音問答。 */}
            <Route path="/voice" element={<AssistantEntry voice />} />
            <Route path="/customers/:customerId" element={<CustomerPage />} />
            <Route path="/customers/:customerId/negotiation" element={<NegotiationPage />} />
            <Route path="/customers/:customerId/quote" element={<QuotePage />} />
            {/* 連鎖續約：送合約申請單，跟開報價一樣只有負責人與他的主管進得去（後端擋） */}
            <Route path="/customers/:customerId/contract" element={<ContractPage />} />
            <Route path="/customers/:customerId/record" element={<RecordVisit />} />
            <Route path="/visits/:visitId" element={<VisitPage />} />
            {/* 舊的主管回覆書籤改到頻道，後續在訊息裡討論。 */}
            <Route path="/escalations" element={<Navigate to="/channels" replace />} />
            <Route path="/oa/forms" element={<OaFormsPage />} />
            <Route path="/oa/apps" element={<OaAppsPage />} />
            <Route path="/oa/new/:code" element={<OaEditorPage />} />
            <Route path="/oa/forms/:formId/edit" element={<OaEditorPage />} />
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
            <Route path="/first-week/lessons/:lessonId" element={<LearningLessonPage />} />
            <Route path="/learning/products" element={<ProductLearningPage />} />
            <Route path="/learning/products/:kind/:tier" element={<ProductLearningPage />} />
            <Route path="/documents/:sourceName" element={<DocumentPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </InkRoutes>
      </div>
      <Assistant key={session?.user.id ?? "guest"} />
      <AssistantTaskNavigation key={`task-navigation-${session?.user.id ?? "guest"}`} />
      <AssistantVoiceHost key={`voice-${session?.user.id ?? "guest"}`} />
      <InkOverlay />
      <UiDemoOverlay />
    </>
  )
}
