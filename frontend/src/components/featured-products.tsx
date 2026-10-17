import type { FeaturedProducts } from "@/api/featured-products"
import { ProductPhoto } from "@/components/product-photo"
import { Badge } from "@/components/ui/badge"
import { formatUnitPrice } from "@/lib/format"
import { formatRate } from "@/lib/negotiation"
import { cn } from "@/lib/utils"

/** 經理明確指定的料號排在自動建議之前，未曾進貨的品項也照樣列出。 */
export function FeaturedProductsBlock({
  featured,
}: {
  featured: FeaturedProducts
}) {
  return (
    <section className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 shadow-lip-primary-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">經理指定主推</h2>
        <p className="text-xs text-muted-foreground">
          {featured.manager_name}指定 · {featured.items.length} 個品項
        </p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        我方商品毛利＝供貨單價－商品成本；未扣通路費用與額外贈品成本。
      </p>
      <ol className="mt-3 flex flex-col gap-3">
        {featured.items.map((item) => (
          <li
            key={item.sku}
            className="rounded-xl border-2 bg-card p-3 shadow-lip"
          >
            <div className="flex items-start gap-3">
              <ProductPhoto product={item} size="compact" />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug font-semibold">
                  {item.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.sku}
                  {item.spec && ` · ${item.spec}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>經理指定</Badge>
                  <Badge
                    variant={
                      item.margin_rate !== null && item.margin_rate < 0
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {item.margin_rate === null
                      ? "毛利待補資料"
                      : `我方毛利 ${formatRate(item.margin_rate, 1)}`}
                  </Badge>
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">
                  每{item.unit}供貨
                </dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">
                  {item.supply_price === null
                    ? "尚無價格"
                    : formatUnitPrice(item.supply_price)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">商品成本</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">
                  {item.unit_cost === null
                    ? "尚無成本資料"
                    : formatUnitPrice(item.unit_cost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">我方單件毛利</dt>
                <dd
                  className={cn(
                    "mt-1 text-sm font-medium tabular-nums",
                    item.unit_margin !== null && item.unit_margin < 0
                      ? "text-destructive"
                      : "text-primary"
                  )}
                >
                  {item.unit_margin === null
                    ? "—"
                    : formatUnitPrice(item.unit_margin)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {item.price_source}
              {item.deal && ` · ${item.deal}；供貨單價已計入同品搭贈`}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
