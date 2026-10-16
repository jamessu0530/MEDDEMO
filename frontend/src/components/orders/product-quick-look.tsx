import { useState } from "react"
import { ExternalLink, ImageOff } from "lucide-react"
import type { OrderProduct } from "@/api/orders"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { orderMoney } from "@/lib/orders"
import { productPhoto } from "@/lib/product-photos"

export function ProductQuickLook({
  product,
  onClose,
  onRestoreFocus,
}: {
  product: OrderProduct
  onClose: () => void
  onRestoreFocus?: () => void
}) {
  const photo = productPhoto(product.sku)
  const [failed, setFailed] = useState(false)
  const available = photo && !failed
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault()
            onRestoreFocus()
          }
        }}
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>產品快速預覽</DialogTitle>
          <DialogDescription className="text-left font-medium text-foreground">
            {product.name}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto p-5 sm:grid-cols-2">
          <figure className="min-w-0 space-y-3">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-white p-5">
              {available ? (
                <img
                  src={photo.src}
                  alt={
                    photo.kind === "exact"
                      ? `${product.name} 商品照片`
                      : `參考示意圖：${photo.title}，非此料號實品照`
                  }
                  className="max-h-full max-w-full object-contain"
                  onError={() => setFailed(true)}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <ImageOff aria-hidden className="size-12" />
                  <span>此產品暫無圖片</span>
                </div>
              )}
            </div>
            <figcaption className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {available && photo.kind === "illustrative" && (
                <p className="rounded-xl bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                  <strong>參考示意圖</strong> · 此料號尚無實品照。圖中商品為「
                  {photo.title}」，請以名稱、料號與規格核對。
                </p>
              )}
              {available && (
                <a
                  href={photo.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center gap-1 underline underline-offset-4"
                >
                  查看圖片來源
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              )}
            </figcaption>
          </figure>
          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-xs text-muted-foreground">
                {product.category || "產品型錄"}
              </p>
              <h3 className="mt-2 text-xl leading-relaxed font-semibold break-words">
                {product.name}
              </h3>
            </div>
            <dl className="divide-y text-sm">
              {[
                ["料號", product.sku],
                ["規格", product.spec || "未提供"],
                ["計價單位", product.unit || "未提供"],
                ["產品系列", product.category || "未提供"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[5rem_1fr] gap-3 py-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words select-text">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-xl bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">本次客戶供貨單價</p>
              <p className="mt-1 text-2xl font-semibold text-primary tabular-nums">
                {orderMoney(product.unit_price)}
                <span className="ml-1 text-xs font-normal">
                  ／{product.unit || "單位"}
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            返回產品清單
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
