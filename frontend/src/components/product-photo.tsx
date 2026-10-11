import { useState } from "react"
import { ImageOff } from "lucide-react"

import type { Product } from "@/api/products"
import { productPhoto } from "@/lib/product-photos"

export function ProductPhoto({ product }: { product: Product }) {
  const photo = productPhoto(product.sku)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const available = photo && failedSrc !== photo.src

  return (
    <figure className="w-24 shrink-0 sm:w-28">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-white">
        {available ? (
          <img
            src={photo.src}
            alt={
              photo.kind === "exact"
                ? `${product.name} 商品照片`
                : `${product.name} 參考示意圖，照片商品：${photo.title}`
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
      <figcaption className="mt-1.5 text-center text-[10px] leading-relaxed text-muted-foreground">
        {available ? (
          <>
            {photo.kind === "exact" ? "商品照片" : "示意圖"}
            {" · "}
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
        ) : (
          "暫無照片"
        )}
      </figcaption>
    </figure>
  )
}
