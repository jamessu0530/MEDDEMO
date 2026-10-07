import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { listProducts, type Product } from "@/api/products"
import {
  updateFields,
  type Commitment,
  type Competitor,
  type FieldKey,
  type IntentItem,
  type Visit,
  type VisitFields,
} from "@/api/visits"
import { FIELD_LABEL } from "@/components/visit/field-format"
import { usePromotions } from "@/components/visit/use-promotions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatMoney } from "@/lib/format"
import { packDeal } from "@/lib/quote"
import { cn } from "@/lib/utils"

type FieldEditorProps = {
  visit: Visit
  field: FieldKey | null
  onClose: () => void
  onSaved: (visit: Visit) => void
}

/** 逐格修改（FR-5.3）：一次只改一個欄位，存檔時整份欄位送回後端驗證 */
export function FieldEditor({ visit, field, onClose, onSaved }: FieldEditorProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: VisitFields[FieldKey]) {
    if (!field) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await updateFields(visit.id, { ...visit.fields, [field]: next }))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗")
    } finally {
      setSaving(false)
    }
  }

  const source = field ? visit.sources[field] : undefined
  const props = { saving, onSave: save }

  return (
    <Dialog open={field !== null} onOpenChange={(open) => !open && onClose()}>
      {/* 欄寬鎖在對話框的寬度：選單照最長的選項算寬度（品項名稱、大口的搭贈都很長），不鎖的話會把對話框撐出畫面 */}
      <DialogContent className="max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        {field && (
          <>
            <DialogHeader>
              <DialogTitle>{FIELD_LABEL[field]}</DialogTitle>
              <DialogDescription>{source ? `逐字稿原文：「${source}」` : "逐字稿裡沒有對應的原文。"}</DialogDescription>
            </DialogHeader>
            {/* key 讓每次打開都從目前的值重新開始 */}
            <div key={`${field}-${visit.id}`} className="flex flex-col gap-3">
              {field === "competitor" && <CompetitorEditor initial={visit.fields.competitor} {...props} />}
              {field === "complaint" && <ComplaintEditor initial={visit.fields.complaint} {...props} />}
              {field === "intent" && <IntentEditor initial={visit.fields.intent} {...props} />}
              {field === "commitment" && <CommitmentEditor initial={visit.fields.commitment} {...props} />}
              {field === "follow_up_date" && <DateEditor initial={visit.fields.follow_up_date} {...props} />}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

type EditorProps<T> = {
  initial: T | null
  saving: boolean
  onSave: (value: T | null) => void
}

function EditorFooter({ saving, onClear, onSave }: { saving: boolean; onClear: () => void; onSave: () => void }) {
  return (
    <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
      <Button type="button" variant="ghost" className="h-11" onClick={onClear} disabled={saving}>
        清空（沒提到）
      </Button>
      <Button type="button" className="h-11 px-6" onClick={onSave} disabled={saving}>
        {saving ? "儲存中…" : "儲存"}
      </Button>
    </DialogFooter>
  )
}

function ComplaintEditor({ initial, saving, onSave }: EditorProps<string>) {
  const [text, setText] = useState(initial ?? "")
  return (
    <>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="客戶對我方產品、配送、價格或服務的不滿"
      />
      <EditorFooter saving={saving} onClear={() => onSave(null)} onSave={() => onSave(text.trim() || null)} />
    </>
  )
}

function DateEditor({ initial, saving, onSave }: EditorProps<string>) {
  const [date, setDate] = useState(initial ?? "")
  return (
    <>
      <Label htmlFor="follow-up">什麼時候再去追</Label>
      <Input id="follow-up" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
      <EditorFooter saving={saving} onClear={() => onSave(null)} onSave={() => onSave(date || null)} />
    </>
  )
}

function CommitmentEditor({ initial, saving, onSave }: EditorProps<Commitment>) {
  const [by, setBy] = useState<Commitment["by"]>(initial?.by ?? "us")
  const [text, setText] = useState(initial?.text ?? "")
  const [due, setDue] = useState(initial?.due ?? "")
  const choices: { value: Commitment["by"]; label: string }[] = [
    { value: "us", label: "我方答應客戶" },
    { value: "customer", label: "客戶答應我方" },
  ]
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            variant={by === choice.value ? "default" : "outline"}
            className="h-11"
            onClick={() => setBy(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      <Label htmlFor="commitment-text">答應的事</Label>
      <Input id="commitment-text" value={text} onChange={(e) => setText(e.target.value)} className="h-11" />
      <Label htmlFor="commitment-due">期限</Label>
      <Input id="commitment-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-11" />
      <EditorFooter
        saving={saving}
        onClear={() => onSave(null)}
        onSave={() => onSave(text.trim() ? { by, text: text.trim(), due: due || null } : null)}
      />
    </>
  )
}

function CompetitorEditor({ initial, saving, onSave }: EditorProps<Competitor[]>) {
  const [rows, setRows] = useState<Competitor[]>(initial ?? [{ name: "", detail: null }])
  const update = (index: number, row: Competitor) => setRows(rows.map((r, i) => (i === index ? row : r)))

  function save() {
    const cleaned = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), detail: r.detail?.trim() || null }))
    onSave(cleaned.length ? cleaned : null)
  }

  return (
    <>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-xl border-2 bg-card p-3 shadow-lip">
          <div className="flex gap-2">
            <Input
              value={row.name}
              onChange={(e) => update(index, { ...row, name: e.target.value })}
              placeholder="競品名稱"
              aria-label="競品名稱"
              className="h-11"
            />
            <RemoveButton onClick={() => setRows(rows.filter((_, i) => i !== index))} />
          </div>
          <Input
            value={row.detail ?? ""}
            onChange={(e) => update(index, { ...row, detail: e.target.value })}
            placeholder="對方開的條件或做的事"
            aria-label="競品條件"
            className="h-11"
          />
        </div>
      ))}
      <AddButton label="新增一家" onClick={() => setRows([...rows, { name: "", detail: null }])} />
      <EditorFooter saving={saving} onClear={() => onSave(null)} onSave={save} />
    </>
  )
}

let productsPromise: Promise<Product[]> | null = null

function useProducts() {
  const [products, setProducts] = useState<Product[]>([])
  useEffect(() => {
    productsPromise ??= listProducts()
    productsPromise.then(setProducts).catch(() => {
      productsPromise = null
    })
  }, [])
  return products
}

function IntentEditor({ initial, saving, onSave }: EditorProps<IntentItem[]>) {
  const products = useProducts()
  const promotions = usePromotions()
  const running = promotions.find((p) => p.status === "進行中")?.items ?? []
  const allPacks = promotions.flatMap((p) => p.items)
  const [rows, setRows] = useState<IntentItem[]>(initial ?? [{ product_text: "", sku: null, qty: null, unit: null, promo_code: null }])
  const update = (index: number, row: IntentItem) => setRows(rows.map((r, i) => (i === index ? row : r)))

  function choose(index: number, sku: string) {
    const row = rows[index]
    const product = products.find((p) => p.sku === sku)
    // 換品項時口一起清掉：口是跟著品項的
    update(
      index,
      product
        ? { ...row, sku: product.sku, unit: product.unit, promo_code: null, product_text: row.product_text || product.name }
        : { ...row, sku: null, promo_code: null }
    )
  }

  // 選了某一口，數量就是口數、單位是「口」；改回不走促銷，單位回到品項的單位
  function choosePack(index: number, code: string) {
    const row = rows[index]
    const product = products.find((p) => p.sku === row.sku)
    update(index, { ...row, promo_code: code || null, unit: code ? "口" : (product?.unit ?? row.unit) })
  }

  // 這個品項在這一期的口；已經選了別期的口（換期前抽的）也列出來，選單才不會跳掉
  function packOptions(row: IntentItem) {
    const options = running.filter((pack) => pack.sku === row.sku)
    const chosen = allPacks.find((pack) => pack.code === row.promo_code)
    return chosen && !options.includes(chosen) ? [...options, chosen] : options
  }

  function save() {
    const cleaned = rows
      .map((r) => ({ ...r, product_text: r.product_text.trim() || products.find((p) => p.sku === r.sku)?.name || "" }))
      .filter((r) => r.product_text)
    onSave(cleaned.length ? cleaned : null)
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">送出 SAP 報價草稿需要每一項都有品項和數量；選了促銷的口，數量就是口數。</p>
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-xl border-2 bg-card p-3 shadow-lip">
          {row.product_text && <p className="text-xs text-muted-foreground">口述講法：{row.product_text}</p>}
          <div className="flex gap-2">
            <select
              value={row.sku ?? ""}
              onChange={(e) => choose(index, e.target.value)}
              aria-label="品項"
              className={cn(
                "h-11 min-w-0 flex-1 rounded-xl border-2 border-input bg-card px-3 text-sm shadow-lip",
                !row.sku && "border-destructive text-muted-foreground"
              )}
            >
              <option value="">請選品項</option>
              {products.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.name}
                </option>
              ))}
            </select>
            <RemoveButton onClick={() => setRows(rows.filter((_, i) => i !== index))} />
          </div>
          {row.sku && packOptions(row).length > 0 && (
            <select
              value={row.promo_code ?? ""}
              onChange={(e) => choosePack(index, e.target.value)}
              aria-label="促銷的口"
              className="h-11 w-full min-w-0 rounded-xl border-2 border-input bg-card px-3 text-sm shadow-lip"
            >
              <option value="">不走促銷</option>
              {packOptions(row).map((pack) => (
                <option key={pack.code} value={pack.code}>
                  {pack.name} · {packDeal(pack)} · {formatMoney(pack.deal_price)}/口
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={row.qty ?? ""}
              onChange={(e) => update(index, { ...row, qty: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null })}
              placeholder={row.promo_code ? "口數" : "數量"}
              aria-label={row.promo_code ? "口數" : "數量"}
              className={cn("h-11 w-28", !row.qty && "border-destructive")}
            />
            <span className="text-sm text-muted-foreground">{row.unit ?? ""}</span>
          </div>
        </div>
      ))}
      <AddButton label="新增品項" onClick={() => setRows([...rows, { product_text: "", sku: null, qty: null, unit: null, promo_code: null }])} />
      <EditorFooter saving={saving} onClear={() => onSave(null)} onSave={save} />
    </>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label="刪除這一項" onClick={onClick}>
      <Trash2 className="size-4" />
    </Button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" className="h-11" onClick={onClick}>
      <Plus className="size-4" />
      {label}
    </Button>
  )
}
