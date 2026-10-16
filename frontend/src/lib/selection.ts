export type SelectionOption = {
  value: string
  label: string
  description?: string
  meta?: string
  keywords?: string
  disabled?: boolean
}

export function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replaceAll("臺", "台")
    .trim()
}

export function searchOptions(options: SelectionOption[], query: string) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  return terms.length
    ? options.filter((option) => {
        const text = normalizeSearch(
          `${option.label} ${option.value} ${option.description ?? ""} ${option.keywords ?? ""}`
        )
        return terms.every((term) => text.includes(term))
      })
    : options
}

export function toggleSelection(
  values: string[],
  value: string,
  maximum = Infinity
) {
  const unique = [...new Set(values)]
  return unique.includes(value)
    ? unique.filter((key) => key !== value)
    : unique.length < maximum
      ? [...unique, value]
      : unique
}

/** A page action changes only that page; selections on other pages survive. */
export function toggleSelectionPage(
  values: string[],
  page: string[],
  maximum = Infinity
) {
  const unique = [...new Set(values)],
    keys = [...new Set(page)]
  if (!keys.length) return unique
  const selected = new Set(unique)
  return keys.every((key) => selected.has(key))
    ? unique.filter((key) => !keys.includes(key))
    : [
        ...unique,
        ...keys
          .filter((key) => !selected.has(key))
          .slice(0, Math.max(0, maximum - unique.length)),
      ]
}
