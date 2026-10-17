import { useNavigate, useSearchParams } from "react-router"

import { BottomNav } from "@/components/bottom-nav"
import { SalesNav, type SalesView } from "@/components/sales-nav"
import { SalesHeader } from "@/components/sales-header"
import { OrdersPage } from "@/pages/orders"
import { ProductsPanel } from "@/pages/products"
import { PromotionsPanel } from "@/pages/promotions"

/** 三個銷售分頁共用入口；切換時保留各自的搜尋、篩選與分頁。 */
export function SalesPage({ newOrder = false }: { newOrder?: boolean }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const requestedView = params.get("view")
  const view: SalesView =
    !newOrder &&
    (requestedView === "products" || requestedView === "promotions")
      ? requestedView
      : "orders"

  function changeView(next: SalesView) {
    if (next === view) return
    setParams((current) => {
      const updated = new URLSearchParams(current)
      if (next === "orders") updated.delete("view")
      else updated.set("view", next)
      return updated
    })
    window.scrollTo({ top: 0, behavior: "instant" })
  }

  const navigation = <SalesNav view={view} onChange={changeView} />
  const heading = <SalesHeader onCreate={() => navigate("/orders/new")} />

  return (
    <div>
      <section hidden={view !== "orders"} aria-label="銷售訂單">
        <OrdersPage
          newOrder={newOrder}
          title="銷售"
          navigation={navigation}
          showBottomNav={false}
          active={view === "orders"}
        />
      </section>
      <section hidden={view !== "products"} aria-label="銷售商品">
        <div className="lg:mx-auto lg:max-w-2xl">
          <ProductsPanel
            heading={heading}
            navigation={navigation}
            active={view === "products"}
          />
        </div>
      </section>
      <section hidden={view !== "promotions"} aria-label="銷售促銷">
        <div className="lg:mx-auto lg:max-w-2xl">
          <PromotionsPanel heading={heading} navigation={navigation} active={view === "promotions"} />
        </div>
      </section>
      <BottomNav />
    </div>
  )
}
