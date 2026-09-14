import { Button } from "@/components/ui/button"

type Action = { label: string; onClick: () => void }

type NoticeProps = {
  text: string
  action: Action
  secondary?: Action
}

// SDD 規定的例外狀態樣式：淺色底、一句說明、一顆補救動作鈕（必要時多一顆替代做法）
export function Notice({ text, action, secondary }: NoticeProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-muted px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" className="h-11 px-5" onClick={action.onClick}>
          {action.label}
        </Button>
        {secondary && (
          <Button variant="ghost" className="h-11 px-5" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  )
}
