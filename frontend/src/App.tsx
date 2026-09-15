import { lazy, Suspense, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { BrowserRouter, Route, Routes, useNavigate } from "react-router"

import { Notice } from "@/components/notice"
import { Onboarding } from "@/components/onboarding"
import { uploadQueue } from "@/lib/offline-queue"
import { AskPage } from "@/pages/ask"
import { CustomerPage } from "@/pages/customer"
import { CustomerPicker } from "@/pages/customer-picker"
import { EscalationsPage } from "@/pages/escalations"
import { ManagerPage } from "@/pages/manager"
import { NegotiationPage } from "@/pages/negotiation"
import { RecordVisit } from "@/pages/record-visit"
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
      <Notice text="找不到這個頁面。" action={{ label: "回客戶清單", onClick: () => navigate("/") }} />
    </div>
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
          <Route path="/" element={<CustomerPicker />} />
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
          <Route path="/manager" element={<ManagerPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {/* FR-11：第一次打開時說明三個主要操作 */}
        <Onboarding />
      </div>
    </BrowserRouter>
  )
}
