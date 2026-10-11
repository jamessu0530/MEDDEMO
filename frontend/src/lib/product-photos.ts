import manifest from "@/data/product-photos.json"

export type ProductPhoto = {
  src: string
  title: string
  sourceUrl: string
  kind: "exact" | "illustrative"
}

type PhotoManifest = {
  products: Record<string, { source: string; kind: ProductPhoto["kind"] }>
  sources: Record<string, { file: string; title: string; pageUrl: string }>
}

const photos: PhotoManifest = manifest as PhotoManifest

/** SKU mappings keep similar names, colors, and package sizes distinct. */
export function productPhoto(sku: string): ProductPhoto | null {
  const match = photos.products[sku]
  const source = match && photos.sources[match.source]
  if (!source) return null
  return {
    src: import.meta.env.BASE_URL + source.file.slice(1),
    title: source.title,
    sourceUrl: source.pageUrl,
    kind: match.kind,
  }
}
