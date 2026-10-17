import type { ReactNode } from "react"
import { useScrollHeader } from "@/lib/use-scroll-header"
import { cn } from "@/lib/utils"

/** 向下閱讀時整塊頁首收起，往回滑或聚焦搜尋時重新顯示。 */
export function CatalogHeader({
  heading,
  navigation,
  children,
  active = true,
}: {
  heading?: ReactNode
  navigation: ReactNode
  children?: ReactNode
  active?: boolean
}) {
  const { ref, hidden, reveal } = useScrollHeader(active)
  return (
    <header
      ref={ref}
      data-catalog-header
      data-collapsed={hidden}
      onFocusCapture={reveal}
      className={cn(
        "sticky top-0 z-10 grid border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur transition-transform duration-200 motion-reduce:transition-none lg:px-6 lg:pt-5",
        hidden && "pointer-events-none -translate-y-full"
      )}
    >
      <div>
        {heading ?? (
          <h1 className="mt-0.5 text-xl font-semibold">商品與促銷</h1>
        )}
      </div>
      {navigation}
      {children}
    </header>
  )
}
