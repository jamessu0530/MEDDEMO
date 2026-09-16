import { useState } from "react"
import { CalendarDays, MessageCircleQuestion, Mic } from "lucide-react"
import { useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import { closeGuide, useGuideOpen } from "@/lib/onboarding"
import { cn } from "@/lib/utils"

// FR-11 的三個主要操作，照業務跑一站的順序：進門前、走出店門、想到就問
const STEPS = [
  {
    icon: CalendarDays,
    title: "打開就是今日路線",
    body: "首頁照時間排好今天跑哪幾家，每一站都寫了為什麼排這家。點一站進客戶檔案，最上面是「進門前三分鐘」：進貨間隔、帳齡、答應過的事和競品，連鎖客戶另有談判卡。最上面「需立即處理」那張卡排錯了，按暫緩或誤判，下次就少排。",
  },
  {
    icon: Mic,
    title: "走出店門，講一分鐘",
    body: "按「語音記錄」口述這次拜訪，系統整理成競品、抱怨、意向、承諾、追蹤五個欄位，你確認後寫進 CRM、SAP、OA。沒有訊號也會先存在手機。",
  },
  {
    icon: MessageCircleQuestion,
    title: "想到就問",
    body: "在「問答」打字，或到「語音」用講的，查數字和公司規定，答案附出處。查不到可以轉給主管，主管回覆了首頁會提醒你。",
  },
]

/** 首次使用引導（FR-11）：第一次打開時蓋在畫面上，一次說明一個操作 */
export function Onboarding() {
  const open = useGuideOpen()
  const { pathname } = useLocation()
  const [step, setStep] = useState(0)
  // 主管端是另一種身分，不必看業務的操作說明
  if (!open || pathname.startsWith("/manager")) return null

  const last = step === STEPS.length - 1
  const { icon: Icon, title, body } = STEPS[step]
  const close = () => {
    closeGuide()
    setStep(0)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-background px-6 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]"
    >
      <div className="flex h-11 justify-end">
        {!last && (
          <Button variant="ghost" className="h-11 text-muted-foreground" onClick={close}>
            略過
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <p className="text-xs font-semibold tracking-wide text-primary">
          三個主要操作 · {step + 1}／{STEPS.length}
        </p>
        <div className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-11" />
        </div>
        <h2 id="guide-title" className="text-xl font-semibold">
          {title}
        </h2>
        <p className="text-[15px] leading-relaxed text-foreground/80">{body}</p>
      </div>
      <div className="flex flex-col items-center gap-5">
        <div className="flex gap-2" aria-hidden>
          {STEPS.map((item, index) => (
            <span
              key={item.title}
              className={cn("h-2 rounded-full transition-all", index === step ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30")}
            />
          ))}
        </div>
        <Button autoFocus className="h-12 w-full text-base" onClick={() => (last ? close() : setStep(step + 1))}>
          {last ? "開始使用" : "下一步"}
        </Button>
      </div>
    </div>
  )
}
