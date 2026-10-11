import { useSearchParams } from "react-router"

import { BottomNav } from "@/components/bottom-nav"
import { CatalogNav, type CatalogView } from "@/components/catalog-nav"
import { ProductsPanel } from "@/pages/products"
import { PromotionsPanel } from "@/pages/promotions"

/** 一個入口看商品與促銷；切換時保留各自的搜尋、分類、分頁與月份。 */
export function CatalogPage() {
  const [params, setParams] = useSearchParams()
  const view: CatalogView =
    params.get("view") === "promotions" ? "promotions" : "products"

  function changeView(next: CatalogView) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      if (next === "products") updated.delete("view")
      else updated.set("view", next)
      return updated
    })
    window.scrollTo({ top: 0, behavior: "instant" })
  }

  const navigation = <CatalogNav view={view} onChange={changeView} />
  return (
    <div>
      <section hidden={view !== "products"} aria-label="商品型錄">
        <ProductsPanel navigation={navigation} />
      </section>
      <section hidden={view !== "promotions"} aria-label="促銷方案">
        <PromotionsPanel navigation={navigation} />
      </section>
      <BottomNav />
    </div>
  )
}
