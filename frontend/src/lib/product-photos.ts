import manifest from "@/data/product-photos.json"

export type ProductPhoto = {
  src: string
  title: string
  sourceUrl: string
  kind: "exact" | "series" | "illustrative"
  note?: string
}

type PhotoManifest = {
  products: Record<
    string,
    { source: string; kind: ProductPhoto["kind"]; note?: string }
  >
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
    note: match.note,
  }
}

/** Only punctuation, brand spelling and outer package notation may differ. */
export function photoNameMatches(name: string, title: string) {
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll("中化健康360", "中化360")
      .replace(/[/／](?:盒|瓶|組|包)/g, "")
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
  return !!normalize(name) && normalize(name) === normalize(title)
}
