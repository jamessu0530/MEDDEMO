import { useState, type FormEvent, type ReactNode } from "react"

import { CUSTOMER_TYPE_LABEL } from "@/api/customers"
import { createMethod, updateMethod, type MethodCard } from "@/api/methods"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { TAG_LABELS, TAGS } from "@/lib/methods"
import { cn } from "@/lib/utils"

// 字數上限跟後端一樣（services/method_cards.py）；超過的部分輸入框就不收，不必等送出才知道
const TITLE_MAX = 40
const SITUATION_MAX = 200
const APPROACH_MAX = 2000
const CUSTOMER_TYPES = Object.keys(CUSTOMER_TYPE_LABEL) as (keyof typeof CUSTOMER_TYPE_LABEL)[]

type MethodCardFormProps = {
  // 有給就是修改這一張，沒給是新增
  card?: MethodCard
  onClose: () => void
  onSaved: (card: MethodCard) => void
}

/** 主管端新增、修改方法卡共用的表單。內容是主管自己寫的，這裡不提供 AI 代寫或改寫 */
export function MethodCardForm({ card, onClose, onSaved }: MethodCardFormProps) {
  const [title, setTitle] = useState(card?.title ?? "")
  const [situation, setSituation] = useState(card?.situation ?? "")
  const [approach, setApproach] = useState(card?.approach ?? "")
  const [customerType, setCustomerType] = useState<MethodCard["customer_type"]>(card?.customer_type ?? null)
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = title.trim().length >= 2 && situation.trim() && approach.trim() && tags.length > 0

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setError(null)
    const input = {
      title: title.trim(),
      situation: situation.trim(),
      approach: approach.trim(),
      customer_type: customerType,
      // 照篩選列的順序存，不照點的先後
      tags: TAGS.filter((tag) => tags.includes(tag)),
    }
    try {
      onSaved(card ? await updateMethod(card.id, input) : await createMethod(input))
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有存成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{card ? "修改方法卡" : "新增方法卡"}</DialogTitle>
          <DialogDescription>
            {card ? "存檔後業務看到的就是新的內容，採用次數照舊。" : "寫好直接上架，全公司的業務都看得到。"}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="標題" htmlFor="method-title" hint={`2～${TITLE_MAX} 個字，一眼看得出是哪種情況。`}>
            <Input
              id="method-title"
              className="h-11"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TITLE_MAX}
              placeholder="例如：帳款超過 60 天，先打電話問付款日"
              autoComplete="off"
            />
          </Field>
          <Field label="什麼時候用" htmlFor="method-situation" hint={`${situation.length} / ${SITUATION_MAX}`}>
            <Textarea
              id="method-situation"
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
              maxLength={SITUATION_MAX}
              rows={2}
              placeholder="業務遇到什麼狀況時該翻這張卡"
            />
          </Field>
          <Field label="怎麼做、怎麼說" htmlFor="method-approach" hint={`${approach.length} / ${APPROACH_MAX}`}>
            <Textarea
              id="method-approach"
              value={approach}
              onChange={(event) => setApproach(event.target.value)}
              maxLength={APPROACH_MAX}
              rows={8}
              placeholder={"一步一步寫，可以直接寫要講的那句話。\n1. 先…\n2. 再…"}
            />
          </Field>
          <Field label="適用的客戶類型" htmlFor="method-customer-type">
            <NativeSelect
              id="method-customer-type"
              value={customerType ?? ""}
              onChange={(event) => setCustomerType((event.target.value || null) as MethodCard["customer_type"])}
            >
              <option value="">都適用</option>
              {CUSTOMER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CUSTOMER_TYPE_LABEL[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm leading-none font-medium">情況標籤</p>
            <div className="flex flex-wrap gap-2">
              {TAGS.map((tag) => {
                const selected = tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "h-9 rounded-full border px-3 text-sm",
                      selected ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
                    )}
                  >
                    {TAG_LABELS[tag]}
                  </button>
                )
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">至少選一個，業務靠標籤找到這張卡。</p>
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" className="h-11" disabled={busy || !ready}>
              {card ? "儲存" : "新增並上架"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}
