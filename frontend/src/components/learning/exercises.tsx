import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  MapPin,
  Send,
} from "@/components/icons"

import type { LessonAnswer } from "@/api/learning"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type Props = { answer: LessonAnswer; onChange: (answer: LessonAnswer) => void }

const CHOICE =
  "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 bg-card px-4 py-3 text-left text-sm shadow-lip press outline-none focus-visible:ring-2 focus-visible:ring-primary"

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        CHOICE,
        selected && "border-primary bg-primary/10 text-primary"
      )}
      onClick={onClick}
    >
      {children}
      {selected && <Check className="size-4 shrink-0" />}
    </button>
  )
}

export function Exercise({ lessonId, ...props }: Props & { lessonId: string }) {
  switch (lessonId) {
    case "customer-v1":
      return <CustomerExercise {...props} />
    case "product-v1":
      return <ProductExercise {...props} />
    case "route-v1":
      return <RouteExercise {...props} />
    case "visit-v1":
      return <VisitExercise {...props} />
    case "ask-v1":
      return <AskExercise {...props} />
    default:
      return <p>找不到這個練習。</p>
  }
}

function CustomerExercise({ answer, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        你準備拜訪「安心藥局」。先點開檔案，再選出今天要優先處理的事。
      </p>
      <div className="rounded-2xl border-2 bg-card p-4 shadow-lip">
        <p className="mb-3 text-xs text-muted-foreground">客戶清單</p>
        <button
          className={CHOICE}
          type="button"
          onClick={() => onChange({ ...answer, opened: true })}
        >
          <span>
            <span className="block font-semibold">安心藥局（練習）</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              獨立藥局 · A 級 · 台北市
            </span>
          </span>
          <ChevronRight className="size-5" />
        </button>
        {answer.opened && (
          <div className="mt-5 space-y-3">
            <h3 className="font-semibold">進門前三分鐘</h3>
            <div className="rounded-xl bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-warning">今天到期的承諾</p>
              <p className="mt-1">上次答應今天帶產品 DM，還沒完成。</p>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">最近進貨</dt>
                <dd>7 天前，間隔正常</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">帳款狀態</dt>
                <dd>沒有逾期</dd>
              </div>
            </dl>
            <p className="pt-2 text-sm font-semibold">這次進門，先做哪件事？</p>
            {[
              ["promise", "帶上答應的 DM，先履行承諾"],
              ["order", "直接推銷，先不提上次的承諾"],
              ["payment", "要求客戶支付逾期帳款"],
            ].map(([value, label]) => (
              <Choice
                key={value}
                selected={answer.priority === value}
                onClick={() => onChange({ ...answer, priority: value })}
              >
                {label}
              </Choice>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProductExercise({ answer, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        切到「促銷」，選金舒胃平，算出客戶買一口總共會收到幾盒。
      </p>
      <div className="rounded-2xl border-2 bg-card p-4 shadow-lip">
        <div
          className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
          role="tablist"
          aria-label="產品目錄"
        >
          {[
            ["products", "產品"],
            ["promotions", "促銷"],
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={answer.view === view}
              className={cn(
                "min-h-11 rounded-lg text-sm",
                answer.view === view &&
                  "bg-card font-semibold text-primary shadow-sm"
              )}
              onClick={() => onChange({ ...answer, view })}
            >
              {label}
            </button>
          ))}
        </div>
        {answer.view === "products" ? (
          <div className="rounded-xl bg-muted/50 p-4 text-sm">
            <p className="font-semibold">金舒胃平</p>
            <p className="mt-1 text-muted-foreground">料號 C130082 · 盒</p>
            <p className="mt-3 text-xs text-muted-foreground">
              一口的條件在「促銷」分頁。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Choice
              selected={answer.sku === "C130082"}
              onClick={() => onChange({ ...answer, sku: "C130082" })}
            >
              <span>
                <span className="block font-semibold">
                  金舒胃平 · 買 10 送 2
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  一口：付費 10 盒，搭贈 2 盒
                </span>
              </span>
            </Choice>
            <Choice
              selected={answer.sku === "C450070"}
              onClick={() => onChange({ ...answer, sku: "C450070" })}
            >
              <span>
                <span className="block font-semibold">
                  骨營膠囊600T · 買 11 送 1
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  一口：付費 11 組，搭贈 1 組
                </span>
              </span>
            </Choice>
            <label
              className="block pt-3 text-sm font-semibold"
              htmlFor="practice-quantity"
            >
              金舒胃平 買一口，總共收到幾盒？
            </label>
            <Input
              id="practice-quantity"
              type="text"
              inputMode="numeric"
              placeholder="包含搭贈的盒數"
              className="h-12"
              value={String(answer.quantity)}
              onChange={(event) =>
                onChange({ ...answer, quantity: event.target.value.trim() })
              }
            />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          這是練習用的促銷條件；正式報價請查看當期方案。
        </p>
      </div>
    </div>
  )
}

const STOPS = {
  clinic: { name: "晨光診所", time: "09:00", note: "早診前約好拜訪" },
  pharmacy: { name: "安心藥局", time: "11:00", note: "店長上午 11 點才有空" },
}

function RouteExercise({ answer, onChange }: Props) {
  const order = answer.order as (keyof typeof STOPS)[]
  function move(index: number, direction: number) {
    const next = [...order]
    const to = index + direction
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange({ ...answer, order: next })
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        今天兩家都有約時間，兩站之間車程 20 分鐘。用箭頭調整順序，先到約 09:00
        的客戶。
      </p>
      <div className="rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h3 className="mb-4 font-semibold">調整今日路線</h3>
        <ol className="space-y-3">
          {order.map((id, index) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded-xl border-2 p-3"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{STOPS[id].name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {STOPS[id].time} · {STOPS[id].note}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11"
                  disabled={index === 0}
                  aria-label={`把${STOPS[id].name}往上移`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11"
                  disabled={index === order.length - 1}
                  aria-label={`把${STOPS[id].name}往下移`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-4" />
          只調整這一份練習路線。
        </p>
      </div>
    </div>
  )
}

function VisitExercise({ answer, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        AI
        草稿裡有一項客戶沒說的內容。先看逐字稿，保留競品，清空沒有依據的下單意向。
      </p>
      <Button
        type="button"
        variant="outline"
        className="min-h-12 whitespace-normal"
        onClick={() => onChange({ ...answer, reviewed: true })}
      >
        <FileText />
        {answer.reviewed ? "已打開示範逐字稿" : "打開示範逐字稿"}
      </Button>
      {answer.reviewed && (
        <blockquote className="rounded-2xl bg-muted p-4 text-sm leading-relaxed">
          「店長說御松田最近有來推促銷，想先比較。我答應下次帶產品
          DM，週五再追蹤。今天沒有談下單。」
        </blockquote>
      )}
      <div className="space-y-4 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h3 className="font-semibold">確認拜訪紀錄</h3>
        <p className="text-xs text-warning">
          AI 整理的草稿，送出前要逐格核對。
        </p>
        <div>
          <label htmlFor="practice-competitor" className="mb-2 block text-sm">
            競品
          </label>
          <Input
            id="practice-competitor"
            className="h-12"
            value={String(answer.competitor)}
            disabled={!answer.reviewed}
            onChange={(event) =>
              onChange({ ...answer, competitor: event.target.value.trim() })
            }
          />
        </div>
        <div>
          <label htmlFor="practice-intent" className="mb-2 block text-sm">
            下單意向
          </label>
          <Textarea
            id="practice-intent"
            value={String(answer.intent)}
            disabled={!answer.reviewed}
            placeholder="客戶沒說的，留空就好"
            onChange={(event) =>
              onChange({ ...answer, intent: event.target.value })
            }
          />
          <Button
            type="button"
            variant="ghost"
            disabled={!answer.reviewed}
            className="mt-2 min-h-11 text-primary"
            onClick={() => onChange({ ...answer, intent: "" })}
          >
            客戶沒說，清空這一格
          </Button>
        </div>
      </div>
    </div>
  )
}

function AskExercise({ answer, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed">
        練習問熊熊滾，打開答案的出處。另一題查不到依據時，選擇下一步。
      </p>
      <div className="space-y-4 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h3 className="font-semibold">問熊熊滾（練習）</h3>
        <p className="rounded-xl bg-muted p-3 text-sm">
          這個促銷，買一口總共收到幾盒？
        </p>
        {!answer.asked && (
          <Button
            type="button"
            className="h-12 w-full"
            onClick={() => onChange({ ...answer, asked: true })}
          >
            <Send />
            送出練習提問
          </Button>
        )}
        {answer.asked && (
          <>
            <p className="text-sm leading-relaxed">
              金舒胃平 一口付費 10 盒、搭贈 2 盒，總共收到 12 盒。
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 w-full whitespace-normal"
              onClick={() => onChange({ ...answer, source_opened: true })}
            >
              <BookOpen />
              查看出處：練習促銷方案
            </Button>
            {answer.source_opened && (
              <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="font-semibold">練習促銷方案 · 金舒胃平</p>
                <p className="mt-1">
                  買 10 盒，搭贈 2 盒。這份文件只用於課程。
                </p>
              </div>
            )}
            <div className="border-t pt-4">
              <p className="text-sm">
                你再問：「這個優惠可以和其他專案一起用嗎？」
              </p>
              <p className="mt-2 rounded-xl bg-warning/10 p-3 text-sm text-warning">
                查無依據：目前文件沒有說明能不能併用。
              </p>
              <p className="mt-4 mb-3 text-sm font-semibold">
                接下來要怎麼做？
              </p>
              <div className="space-y-3">
                <Choice
                  selected={answer.action === "escalate"}
                  onClick={() => onChange({ ...answer, action: "escalate" })}
                >
                  到頻道請主管確認
                </Choice>
                <Choice
                  selected={answer.action === "guess"}
                  onClick={() => onChange({ ...answer, action: "guess" })}
                >
                  直接答應客戶可以併用
                </Choice>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        這裡顯示固定的練習回答，不會傳送提問給 AI 或主管。
      </p>
    </div>
  )
}
