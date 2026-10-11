import type {
  MethodCardInput,
  MethodCardSource,
  MethodSourceMessage,
} from "@/api/methods"

export const METHOD_APPROACH_MAX = 2000
export type MethodSourceDraft =
  | { kind: "unchanged" }
  | { kind: "chosen"; message: MethodSourceMessage }
  | { kind: "removed" }

export function methodSourcePatch(
  draft: MethodSourceDraft
): Pick<MethodCardInput, "source_message_id"> {
  if (draft.kind === "unchanged") return {}
  return {
    source_message_id:
      draft.kind === "removed" ? null : draft.message.message_id,
  }
}

export function methodSourceForDisplay(
  draft: MethodSourceDraft,
  original?: MethodCardSource | null
): MethodCardSource | null {
  if (draft.kind === "unchanged") return original ?? null
  if (draft.kind === "removed") return null
  return { ...draft.message, can_view: true }
}

/** Selection fills only a blank draft. Overlong originals stay complete and must be edited before saving. */
export function quoteMethodSource(current: string, body: string) {
  const inserted = !current.trim()
  const approach = inserted ? body : current
  return {
    approach,
    inserted,
    needsCondensing: approach.length > METHOD_APPROACH_MAX,
  }
}

export function methodSourceAccess(
  source: MethodCardSource
): "viewable" | "restricted" | "missing" {
  const valid =
    typeof source.channel_id === "number" &&
    Number.isInteger(source.channel_id) &&
    source.channel_id > 0 &&
    typeof source.message_id === "number" &&
    Number.isInteger(source.message_id) &&
    source.message_id > 0
  if (!valid) return "missing"
  return source.can_view ? "viewable" : "restricted"
}

/** A retried cursor may include a row already loaded; refresh it without duplicating or moving it. */
export function mergeMethodSources(
  current: MethodSourceMessage[],
  next: MethodSourceMessage[]
) {
  const messages = new Map(
    current.map((message) => [message.message_id, message])
  )
  for (const message of next) messages.set(message.message_id, message)
  return [...messages.values()]
}
