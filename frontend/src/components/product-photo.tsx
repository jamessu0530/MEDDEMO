import { useState } from "react"
import { ImageOff } from "lucide-react"

import type { Product } from "@/api/products"
import { productPhoto } from "@/lib/product-photos"

type ProductPhotoProps = {
  product: Pick<Product, "sku" | "name">
  size?: "default" | "compact"
  showSource?: boolean
}

export function ProductPhoto({
  product,
  size = "default",
  showSource = true,
}: ProductPhotoProps) {
  const photo = productPhoto(product.sku)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const available =
    photo &&
    failedSrc !== photo.src &&
    (photo.kind === "exact" || photo.kind === "series")

  return (
    <figure
      className={size === "compact" ? "w-16 shrink-0" : "w-24 shrink-0 sm:w-28"}
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-white">
        {available ? (
          <img
            src={photo.src}
            alt={
              photo.kind === "exact"
                ? `${product.name} 商品照片`
                : `${product.name} 同系列商品照，照片商品：${photo.title}；容量、尺寸與包裝以商品名稱為準`
            }
            width={112}
            height={112}
            loading="lazy"
            decoding="async"
            className="size-full object-contain p-1.5"
            onError={() => setFailedSrc(photo.src)}
          />
        ) : (
          <ImageOff
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      <figcaption
        title={available ? `${photo.title}；${photo.note ?? ""}` : undefined}
        className="mt-1.5 text-center text-xs leading-relaxed text-muted-foreground"
      >
        {available ? (
          <>
            {photo.kind === "exact"
              ? "商品照片"
              : photo.kind === "series"
                ? "同系列商品照"
                : "同名商品參考照"}
            {showSource && (
              <>
                {" "}
                ·{" "}
                <a
                  href={photo.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`照片商品：${photo.title}`}
                  aria-label={`${product.name} 的圖片來源：${photo.title}`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  來源
                </a>
              </>
            )}
          </>
        ) : (
          "待補商品照"
        )}
      </figcaption>
    </figure>
  )
}
