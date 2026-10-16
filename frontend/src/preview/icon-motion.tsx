import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpenText,
  CalendarDays,
  Car,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Clock,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Flag,
  Footprints,
  Handshake,
  Heart,
  Lightbulb,
  LoaderCircle,
  MapPin,
  MessageCircleQuestion,
  MessagesSquare,
  Mic,
  Moon,
  Motorbike,
  Network,
  Package,
  Pause,
  Pencil,
  Pill,
  Plus,
  Play,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TrainFront,
  Trash2,
  TriangleAlert,
  Trophy,
  Upload,
  Users,
  Volume2,
  X,
  type LucideIcon,
} from "@/components/icons"

import { ReportVisualIcon } from "@/components/reports/report-visual-icon"
import {
  playIconMotions,
  useIconMotion,
} from "@/components/icons/use-icon-motion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import "../index.css"

const tabs = [
  { label: "今日", icon: CalendarDays },
  { label: "訂單", icon: ClipboardList },
  { label: "頻道", icon: MessagesSquare },
  { label: "問答", icon: MessageCircleQuestion },
  { label: "商品", icon: Pill },
]

const stories: {
  icon: LucideIcon
  title: string
  caption: string
  sequence: string
}[] = [
  {
    icon: Pill,
    title: "膠囊打開了",
    caption: "兩半分開，小顆粒散出，再輕輕合上。",
    sequence: "打開 → 散出 → 合上",
  },
  {
    icon: CalendarDays,
    title: "翻到新的一天",
    caption: "書環留在原位，紙張翻過，日期依序出現。",
    sequence: "翻頁 → 日期浮現",
  },
  {
    icon: MessagesSquare,
    title: "對話有來有往",
    caption: "三顆小點正在輸入，另一個泡泡接著回覆。",
    sequence: "輸入中 → 收到回覆",
  },
  {
    icon: Send,
    title: "真的飛出去了",
    caption: "紙飛機收起機翼，沿著尾跡飛走，再回到起點。",
    sequence: "蓄力 → 起飛 → 回來",
  },
  {
    icon: BookOpenText,
    title: "翻開一本方法卡",
    caption: "左右書頁打開，頁面上的文字重新寫出。",
    sequence: "翻開 → 寫入文字",
  },
  {
    icon: Bell,
    title: "鈴鐺響起來",
    caption: "鐘身和鐘舌往不同方向擺，聲波跟著出現。",
    sequence: "擺動 → 叮鈴 → 停穩",
  },
  {
    icon: Package,
    title: "拆開一點驚喜",
    caption: "盒蓋掀開，一點星光從盒子裡冒出。",
    sequence: "開箱 → 驚喜 → 蓋上",
  },
  {
    icon: Eye,
    title: "眨眼，再看看",
    caption: "眼睛眨一下，瞳孔往旁邊看，然後看回來。",
    sequence: "眨眼 → 看右邊 → 回正",
  },
]

const groups: {
  title: string
  caption: string
  icons: [LucideIcon, string][]
}[] = [
  {
    title: "每天見面的老朋友",
    caption: "熟悉的入口，多了一點個性。",
    icons: [
      [CalendarDays, "今日"],
      [Users, "客戶"],
      [MessagesSquare, "頻道"],
      [MessageCircleQuestion, "問答"],
      [Pill, "商品"],
      [Bell, "通知"],
      [BookOpenText, "方法卡"],
      [ChartNoAxesCombined, "報表"],
      [FileText, "申請單"],
      [Settings, "設定"],
      [Sun, "淺色"],
      [Moon, "深色"],
    ],
  },
  {
    title: "出發，沿路都是小動作",
    caption: "交通輕輕前進，地標跳一下，旗子搖搖。",
    icons: [
      [MapPin, "地標"],
      [Route, "路線"],
      [Car, "開車"],
      [Motorbike, "騎車"],
      [TrainFront, "大眾運輸"],
      [Footprints, "步行"],
      [Flag, "收工"],
      [Clock, "時間"],
      [Handshake, "拜訪"],
      [Package, "商品包裹"],
      [Network, "組織"],
      [Trophy, "成就"],
    ],
  },
  {
    title: "每次操作，都有回應",
    caption: "送出的小飛機、尋找的放大鏡，以及會點頭的勾勾。",
    icons: [
      [Search, "搜尋"],
      [Send, "送出"],
      [Mic, "錄音"],
      [Volume2, "聲音"],
      [Download, "下載"],
      [Upload, "上傳"],
      [RefreshCw, "重新整理"],
      [Pencil, "編輯"],
      [Plus, "新增"],
      [Check, "完成"],
      [Eye, "查看"],
      [ShieldCheck, "驗證"],
    ],
  },
  {
    title: "連小細節，也活起來",
    caption: "跟著方向移動，完成時再小小慶祝。",
    icons: [
      [ArrowLeft, "返回"],
      [ArrowRight, "下一步"],
      [ArrowUp, "上移"],
      [ArrowDown, "下移"],
      [ChevronDown, "展開"],
      [Sparkles, "AI 靈感"],
      [Lightbulb, "提示"],
      [Heart, "收藏"],
      [TriangleAlert, "提醒"],
      [Trash2, "刪除"],
      [X, "關閉"],
    ],
  },
]

export function IconMotionPreview() {
  useIconMotion()
  const [selected, setSelected] = useState(0)
  const [autoplay, setAutoplay] = useState(true)
  const storyRef = useRef<HTMLDivElement>(null)
  const [dark, setDark] = useState(false)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (!autoplay || media.matches) return
    let index = 0
    const advance = () => {
      const root = storyRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return
      const cards = [
        ...root.querySelectorAll<HTMLElement>("[data-story]"),
      ].filter((card) => {
        const bounds = card.getBoundingClientRect()
        return bounds.bottom > 0 && bounds.top < window.innerHeight
      })
      const card = cards[index % cards.length]
      if (card) playIconMotions(card)
      index++
    }
    const frame = requestAnimationFrame(advance)
    const timer = setInterval(advance, 2100)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
    }
  }, [autoplay])

  function toggleSkin() {
    const next = !dark
    setDark(next)
    if (next) document.documentElement.dataset.skin = "dark"
    else delete document.documentElement.dataset.skin
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-10 sm:py-12">
      <header className="mb-10 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold tracking-widest text-muted-foreground">
          MEDDEMO{" "}
          <span className="ml-2 font-normal tracking-normal">/ 圖示動態</span>
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-10"
            onClick={() =>
              storyRef.current && playIconMotions(storyRef.current)
            }
          >
            <RefreshCw />
            全部播放
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            onClick={toggleSkin}
            aria-label={dark ? "換成淺色" : "換成深色"}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <section className="mb-10 grid items-center gap-8 rounded-3xl border-2 bg-card p-6 shadow-lip sm:p-9 lg:grid-cols-2">
        <div>
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-primary">
            <Sparkles className="size-4" />
            一點動態，一點生命力
          </p>
          <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
            每個圖示，都有一段小故事。
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
            滑過、點一下，或用 Tab 選到圖示。
            <br />
            翻一頁、拆一顆藥丸，或讓紙飛機真的飛出去。
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            已套用到 App；系統開啟「減少動態效果」時會自動靜止。
          </p>
        </div>
        <div>
          <nav
            aria-label="分頁動態試玩"
            className="flex gap-1 rounded-2xl bg-muted p-1.5"
          >
            {tabs.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                type="button"
                aria-current={selected === index ? "page" : undefined}
                onClick={() => setSelected(index)}
                className={cn(
                  "flex min-h-20 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  selected === index
                    ? "bg-primary text-primary-foreground shadow-lip-primary"
                    : "text-muted-foreground hover:bg-card"
                )}
              >
                <Icon className="size-6" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={() => setNotice("鈴鈴！有 3 則新回覆。 ")}
            >
              <Bell
                data-icon-attention="true"
                className="size-5 text-warning"
              />
              3 則新回覆
            </Button>
            <Button
              className="h-11 gap-2"
              onClick={() => setNotice("完成，今天也前進了一步！")}
            >
              <Check className="size-5" />
              完成拜訪
            </Button>
          </div>
          <p
            role="status"
            className="mt-3 min-h-5 text-center text-xs text-muted-foreground"
          >
            {notice || "切換分頁，看看圖示裡的小機關。"}
          </p>
        </div>
      </section>

      <section className="mb-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">先看這八個小故事</h2>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              可以滑過、點一下，也可以讓它們輪流演給你看。
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10 gap-2"
            aria-pressed={autoplay}
            onClick={() => setAutoplay((value) => !value)}
          >
            {autoplay ? <Pause /> : <Play />}
            {autoplay ? "暫停輪播" : "開始輪播"}
          </Button>
        </div>
        <div ref={storyRef} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stories.map(({ icon: Icon, title, caption, sequence }) => (
            <button
              key={title}
              data-story
              type="button"
              aria-label={`播放${title}`}
              className="group flex min-h-60 flex-col items-center rounded-3xl border-2 bg-card px-4 py-6 text-center shadow-lip transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring"
            >
              <span className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-accent/35 text-primary transition-colors group-hover:bg-accent/65">
                <Icon className="size-11" strokeWidth={1.6} />
              </span>
              <span className="text-sm font-semibold">{title}</span>
              <span className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {caption}
              </span>
              <span className="mt-3 text-[10px] font-medium text-primary">
                {sequence}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-9">
        {groups.map(({ title, caption, icons }) => (
          <section key={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              {caption}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6 lg:grid-cols-12">
              {icons.map(([Icon, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={`試玩${label}動態`}
                  onClick={() => setNotice(`試玩了「${label}」`)}
                  className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-card text-muted-foreground shadow-lip transition-colors outline-none hover:border-primary/40 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring active:bg-muted"
                >
                  <Icon className="size-6" />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-9 rounded-2xl border-2 bg-card p-5">
        <h2 className="text-sm font-semibold">報表圖示與既有狀態</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {(["column", "line", "pie", "matrix"] as const).map((visual) => (
            <Button
              key={visual}
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={`預覽 ${visual} 報表圖示`}
            >
              <ReportVisualIcon visual={visual} />
            </Button>
          ))}
          <Button variant="outline" className="h-11" disabled>
            <LoaderCircle className="size-4 animate-spin" />
            載入中
          </Button>
          <Button variant="outline" className="h-11" disabled>
            <Trash2 className="size-4" />
            尚不可刪除
          </Button>
          <Button variant="outline" className="h-11" aria-expanded="true">
            <ChevronDown className="size-4 rotate-180" />
            已展開
          </Button>
        </div>
      </section>
      <p className="mt-8 text-xs leading-6 text-muted-foreground">
        動態方向參考：
        <a
          className="underline underline-offset-4"
          href="https://lucide-animated.com/"
          target="_blank"
          rel="noreferrer"
        >
          Lucide Animated
        </a>{" "}
        ·{" "}
        <a
          className="underline underline-offset-4"
          href="https://animate-ui.com/docs/icons"
          target="_blank"
          rel="noreferrer"
        >
          Animate UI
        </a>{" "}
        ·{" "}
        <a
          className="underline underline-offset-4"
          href="https://lordicon.com/docs/animation"
          target="_blank"
          rel="noreferrer"
        >
          Lordicon
        </a>
        。這裡的分層圖示與動作為本專案製作。
      </p>
    </main>
  )
}

const root =
  (import.meta.hot?.data.iconMotionRoot as Root | undefined) ??
  createRoot(document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.data.iconMotionRoot = root
root.render(
  <StrictMode>
    <IconMotionPreview />
  </StrictMode>
)
