import { useRef, useState, type FormEvent, type ReactNode } from "react"
import { MessageSquareQuote, X } from "lucide-react"

import { CUSTOMER_TYPE_LABEL } from "@/api/customers"
import {
  createMethod,
  updateMethod,
  type MethodCard,
  type MethodSourceMessage,
} from "@/api/methods"
import { MethodSourceDisplay } from "@/components/method-source-display"
import { MethodSourcePicker } from "@/components/method-source-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { TAG_LABELS, TAGS } from "@/lib/methods"
import {
  METHOD_APPROACH_MAX,
  methodSourceAccess,
  methodSourceForDisplay,
  methodSourcePatch,
  quoteMethodSource,
  type MethodSourceDraft,
} from "@/lib/method-source"
import { cn } from "@/lib/utils"

// 字數上限跟後端一樣（services/method_cards.py）；超過的部分輸入框就不收，不必等送出才知道
const TITLE_MAX = 40
const SITUATION_MAX = 200
const APPROACH_MAX = METHOD_APPROACH_MAX
const CUSTOMER_TYPES = Object.keys(
  CUSTOMER_TYPE_LABEL
) as (keyof typeof CUSTOMER_TYPE_LABEL)[]

type MethodCardFormProps = {
  // 有給就是修改這一張，沒給是新增
  card?: MethodCard
  source?: MethodSourceMessage
  onClose: () => void
  onSaved: (card: MethodCard) => void
}

/** 主管端新增、修改方法卡共用的表單。內容是主管自己寫的，這裡不提供 AI 代寫或改寫 */
export function MethodCardForm(props: MethodCardFormProps) {
  return (
    <MethodCardDraft
      key={`${props.card?.id ?? "new"}:${props.source?.message_id ?? "none"}`}
      {...props}
    />
  )
}

function MethodCardDraft({
  card,
  source,
  onClose,
  onSaved,
}: MethodCardFormProps) {
  const [title, setTitle] = useState(card?.title ?? "")
  const [situation, setSituation] = useState(card?.situation ?? "")
  const [approach, setApproach] = useState(() =>
    !card && source
      ? quoteMethodSource("", source.body).approach
      : (card?.approach ?? "")
  )
  const [customerType, setCustomerType] = useState<MethodCard["customer_type"]>(
    card?.customer_type ?? null
  )
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceDraft, setSourceDraft] = useState<MethodSourceDraft>(() =>
    source ? { kind: "chosen", message: source } : { kind: "unchanged" }
  )
  const [sourcePicker, setSourcePicker] = useState(false)
  const [sourceNotice, setSourceNotice] = useState<string | null>(null)
  const sourceButton = useRef<HTMLButtonElement>(null)
  const approachInput = useRef<HTMLTextAreaElement>(null)
  const currentSource = methodSourceForDisplay(sourceDraft, card?.source)

  const ready =
    title.trim().length >= 2 &&
    title.trim().length <= TITLE_MAX &&
    situation.trim().length > 0 &&
    situation.trim().length <= SITUATION_MAX &&
    approach.trim().length > 0 &&
    approach.length <= APPROACH_MAX &&
    tags.length > 0

  function closePicker() {
    setSourcePicker(false)
    requestAnimationFrame(() => sourceButton.current?.focus())
  }

  function chooseSource(message: MethodSourceMessage) {
    if (busy) return
    setSourceDraft({ kind: "chosen", message })
    if (!card) {
      const quotation = quoteMethodSource(approach, message.body)
      setApproach(quotation.approach)
      setSourceNotice(
        quotation.inserted
          ? "已帶入完整原文，請整理做法並補上使用情境。"
          : "已保留你正在整理的內容；需要新原文時，可按「用原文取代做法」。"
      )
    } else setSourceNotice("已變更來源，原有做法仍保留，可自行整理或引用原文。")
    closePicker()
  }

  function quoteOriginal() {
    if (
      busy ||
      !currentSource ||
      typeof currentSource.body !== "string" ||
      methodSourceAccess(currentSource) !== "viewable"
    )
      return
    setApproach(currentSource.body)
    setSourceNotice("已帶入完整原文，請自行整理後再上架。")
    requestAnimationFrame(() => approachInput.current?.focus())
  }

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag]
    )
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
      ...methodSourcePatch(sourceDraft),
    }
    try {
      onSaved(
        card ? await updateMethod(card.id, input) : await createMethod(input)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "沒有存成功，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90svh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {sourcePicker
                ? "選取經理發言"
                : card
                  ? "修改方法卡"
                  : "新增方法卡"}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              className="size-11"
              aria-label="關閉方法卡表單"
              disabled={busy}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <DialogDescription>
            {sourcePicker
              ? "從你可見的頻道選取經理本人寫下的原始發言。"
              : card
                ? "存檔後業務看到的就是新的內容，採用次數照舊。"
                : "寫好直接上架，全公司的業務都看得到。"}
          </DialogDescription>
        </DialogHeader>
        {sourcePicker ? (
          <MethodSourcePicker
            onSelect={chooseSource}
            onCancel={closePicker}
            disabled={busy}
          />
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <fieldset disabled={busy} className="contents">
              <section className="space-y-3" aria-label="經理發言來源">
                <p className="text-sm font-medium">引用的經理發言</p>
                {currentSource ? (
                  <MethodSourceDisplay
                    source={currentSource}
                    showLink={false}
                  />
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    可從任何你看得到的頻道選取原文，再整理成全公司可用的方法卡。
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    ref={sourceButton}
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => !busy && setSourcePicker(true)}
                  >
                    <MessageSquareQuote aria-hidden="true" />
                    {currentSource ? "換選來源發言" : "從頻道選取經理發言"}
                  </Button>
                  {currentSource && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 text-muted-foreground"
                      onClick={() => {
                        if (busy) return
                        setSourceDraft({ kind: "removed" })
                        setSourceNotice("已移除來源，整理過的做法仍保留。")
                      }}
                    >
                      移除來源
                    </Button>
                  )}
                </div>
                {currentSource &&
                  methodSourceAccess(currentSource) === "viewable" &&
                  typeof currentSource.body === "string" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 px-0 text-primary"
                      onClick={quoteOriginal}
                    >
                      {approach.trim() ? "用原文取代做法" : "引用原文到做法"}
                    </Button>
                  )}
                {sourceNotice && (
                  <p
                    role="status"
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    {sourceNotice}
                  </p>
                )}
              </section>
              <Field
                label="標題"
                htmlFor="method-title"
                hint={`2～${TITLE_MAX} 個字，一眼看得出是哪種情況。`}
              >
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
              <Field
                label="什麼時候用"
                htmlFor="method-situation"
                hint={`${situation.length} / ${SITUATION_MAX}`}
              >
                <Textarea
                  id="method-situation"
                  value={situation}
                  onChange={(event) => setSituation(event.target.value)}
                  maxLength={SITUATION_MAX}
                  rows={2}
                  placeholder="業務遇到什麼狀況時該翻這張卡"
                />
              </Field>
              <Field
                label="怎麼做、怎麼說"
                htmlFor="method-approach"
                hint={`${approach.length} / ${APPROACH_MAX}`}
              >
                {approach.length > APPROACH_MAX && (
                  <p
                    id="method-approach-too-long"
                    role="alert"
                    className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
                  >
                    原文共 {approach.length} 字，已完整保留。請自行整理到{" "}
                    {APPROACH_MAX} 字以內後再送出，系統不會截斷原文。
                  </p>
                )}
                <Textarea
                  id="method-approach"
                  ref={approachInput}
                  className="max-h-80 overflow-y-auto"
                  value={approach}
                  onChange={(event) => {
                    setApproach(event.target.value)
                    setSourceNotice(null)
                  }}
                  maxLength={APPROACH_MAX}
                  rows={8}
                  aria-invalid={approach.length > APPROACH_MAX}
                  aria-describedby={
                    approach.length > APPROACH_MAX
                      ? "method-approach-too-long"
                      : undefined
                  }
                  placeholder={
                    "一步一步寫，可以直接寫要講的那句話。\n1. 先…\n2. 再…"
                  }
                />
              </Field>
              <Field label="適用的客戶類型" htmlFor="method-customer-type">
                <NativeSelect
                  id="method-customer-type"
                  value={customerType ?? ""}
                  onChange={(event) =>
                    setCustomerType(
                      (event.target.value ||
                        null) as MethodCard["customer_type"]
                    )
                  }
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
                          "h-11 press rounded-full border-2 px-3 text-sm",
                          selected
                            ? "border-primary bg-primary text-primary-foreground shadow-lip-primary"
                            : "bg-card text-muted-foreground shadow-lip"
                        )}
                      >
                        {TAG_LABELS[tag]}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  至少選一個，業務靠標籤找到這張卡。
                </p>
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive"
                >
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={onClose}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  className="h-11"
                  disabled={busy || !ready}
                >
                  {card ? "儲存" : "新增並上架"}
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
