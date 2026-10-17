import { Button } from "@/components/ui/button"

export function QuestionSuggestions({
  suggestions,
  onSelect,
  label = "接著可以問",
}: {
  suggestions: string[]
  onSelect: (text: string) => void
  label?: string
}) {
  if (!suggestions.length) return null
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-label={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((text) => (
          <Button
            key={text}
            type="button"
            variant="outline"
            onClick={() => onSelect(text)}
            className="h-auto min-h-9 max-w-full justify-start rounded-xl border-border/70 bg-background/60 px-3 py-2 text-left text-xs leading-relaxed whitespace-normal text-muted-foreground shadow-none hover:text-foreground active:transform-none"
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** 同一個帶入動作也提供觸控入口，鍵盤提示只在可補全時出現。 */
export function SuggestionHint({
  suggestion,
  onAccept,
  id,
}: {
  suggestion: string
  onAccept: () => void
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onAccept}
      title={`帶入建議：${suggestion}`}
      className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <kbd className="rounded border bg-background px-1 py-0.5 text-[10px] [@media(pointer:coarse)]:hidden">
        Tab
      </kbd>
      <span>帶入建議</span>
      <span className="min-w-0 flex-1 truncate opacity-70">{suggestion}</span>
    </button>
  )
}
