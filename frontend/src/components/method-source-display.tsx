import { Link } from "react-router"
import { ArrowUpRight, MessageSquareQuote } from "@/components/icons"

import type { MethodCard } from "@/api/methods"
import { formatTaipeiDateTime } from "@/lib/format"
import { methodSourceAccess } from "@/lib/method-source"
import { cn } from "@/lib/utils"

export function MethodSourceDisplay({
  source,
  className,
  showLink = true,
}: {
  source: MethodCard["source"]
  className?: string
  showLink?: boolean
}) {
  if (!source) return null
  const access = methodSourceAccess(source)
  const createdAt = Number.isNaN(Date.parse(source.created_at))
    ? null
    : formatTaipeiDateTime(source.created_at)
  return (
    <aside
      className={cn(
        "rounded-xl border border-border bg-muted/30 p-3",
        className
      )}
      aria-label="方法卡的原始發言來源"
    >
      <p className="flex items-start gap-2 text-xs font-medium">
        <MessageSquareQuote
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">
          來源發言：{source.author_name || "經理"}
        </span>
      </p>
      {createdAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          <time dateTime={source.created_at}>{createdAt}</time>
        </p>
      )}
      {access === "viewable" ? (
        <>
          {source.channel_name && (
            <p className="mt-2 text-xs break-words text-muted-foreground">
              頻道：{source.channel_name}
            </p>
          )}
          {typeof source.body === "string" && (
            <details className="mt-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs text-primary outline-none focus-visible:underline">
                查看經理原文
              </summary>
              <blockquote className="max-h-64 overflow-y-auto border-l-2 border-primary/30 pl-3 text-xs leading-relaxed break-words whitespace-pre-wrap">
                {source.body}
              </blockquote>
            </details>
          )}
          {showLink && (
            <Link
              className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs text-primary underline-offset-2 focus-visible:underline"
              to={`/channels/${source.channel_id}?message=${source.message_id}`}
            >
              前往原訊息
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {access === "restricted"
            ? "來源頻道依權限開放"
            : "原訊息目前無法查看"}
        </p>
      )}
    </aside>
  )
}
