import { useEffect, useRef, useState } from "react"
import { ArrowLeft, LoaderCircle, Search } from "@/components/icons"

import {
  listMethodSources,
  type MethodSourceMessage,
  type MethodSourcesPage,
} from "@/api/methods"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatTaipeiDateTime } from "@/lib/format"
import { METHOD_APPROACH_MAX, mergeMethodSources } from "@/lib/method-source"

type Snapshot =
  | { key: string; status: "ready"; page: MethodSourcesPage }
  | { key: string; status: "error"; message: string }
type More =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; message: string }

export function MethodSourcePicker({
  onSelect,
  onCancel,
  disabled = false,
}: {
  onSelect: (message: MethodSourceMessage) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [keyword, setKeyword] = useState("")
  const [retry, setRetry] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [more, setMore] = useState<More | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const q = keyword.trim()
  const queryKey = JSON.stringify([q, retry])
  const active = snapshot?.key === queryKey ? snapshot : null
  const moreActive = more?.key === queryKey ? more : null

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        listMethodSources({ q, limit: 20 }, controller.signal)
          .then((page) => {
            if (!controller.signal.aborted) {
              setSnapshot({ key: queryKey, status: "ready", page })
              setMore(null)
            }
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setSnapshot({
                key: queryKey,
                status: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "來源發言暫時載入不了",
              })
          })
      },
      q ? 250 : 0
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      moreController.current?.abort()
    }
  }, [q, queryKey])

  async function loadMore() {
    if (
      disabled ||
      active?.status !== "ready" ||
      active.page.next_before === null ||
      moreActive?.status === "loading"
    )
      return
    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setMore({ key: queryKey, status: "loading" })
    try {
      const page = await listMethodSources(
        { q, before: active.page.next_before, limit: 20 },
        controller.signal
      )
      if (controller.signal.aborted) return
      setSnapshot((current) =>
        current?.key === queryKey && current.status === "ready"
          ? {
              key: queryKey,
              status: "ready",
              page: {
                items: mergeMethodSources(current.page.items, page.items),
                next_before: page.next_before,
              },
            }
          : current
      )
      setMore(null)
    } catch (error) {
      if (!controller.signal.aborted)
        setMore({
          key: queryKey,
          status: "error",
          message:
            error instanceof Error ? error.message : "更多發言暫時載入不了",
        })
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="搜尋經理原始發言">
      <Button
        type="button"
        variant="ghost"
        className="h-11 self-start px-0"
        onClick={onCancel}
        disabled={disabled}
      >
        <ArrowLeft aria-hidden="true" />
        返回方法卡
      </Button>
      <div className="space-y-2">
        <label htmlFor="method-source-search" className="text-sm font-medium">
          搜尋所有可見頻道
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="method-source-search"
            type="search"
            className="h-11 pl-9"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            maxLength={200}
            placeholder="搜尋經理發言"
            autoComplete="off"
            autoFocus
            disabled={disabled}
          />
        </div>
      </div>
      {!active && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在搜尋經理發言…
        </p>
      )}
      {active?.status === "error" && (
        <div
          role="alert"
          className="space-y-3 rounded-xl bg-destructive/10 p-3"
        >
          <p className="text-sm text-destructive">{active.message}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setRetry((value) => value + 1)}
            disabled={disabled}
          >
            重新搜尋
          </Button>
        </div>
      )}
      {active?.status === "ready" && (
        <>
          {active.page.items.length === 0 ? (
            <p
              role="status"
              className="rounded-xl bg-muted/30 px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground"
            >
              {q
                ? "找不到符合的經理發言，試試其他關鍵字。"
                : "目前沒有可選的經理發言。"}
            </p>
          ) : (
            <ol className="space-y-3" aria-label="可引用的經理發言">
              {active.page.items.map((message) => (
                <li key={message.message_id}>
                  <article className="rounded-xl border-2 border-border bg-card p-3">
                    <p className="text-sm font-medium break-words">
                      {message.author_name}
                    </p>
                    <p className="mt-1 text-xs break-words text-muted-foreground">
                      {message.channel_name} ·{" "}
                      <time dateTime={message.created_at}>
                        {formatTaipeiDateTime(message.created_at)}
                      </time>
                    </p>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {message.body}
                    </p>
                    <details className="mt-1">
                      <summary className="flex min-h-11 cursor-pointer items-center text-xs text-primary outline-none focus-visible:underline">
                        展開完整發言
                      </summary>
                      <blockquote className="max-h-60 overflow-y-auto border-l-2 border-primary/30 pl-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                        {message.body}
                      </blockquote>
                    </details>
                    {message.body.length > METHOD_APPROACH_MAX && (
                      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                        原文 {message.body.length} 字，引用後需整理至{" "}
                        {METHOD_APPROACH_MAX} 字以內。
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-1 h-11 w-full"
                      disabled={disabled}
                      aria-label={`選用${message.author_name}在${message.channel_name}的發言`}
                      onClick={() => onSelect(message)}
                    >
                      選用這段發言
                    </Button>
                  </article>
                </li>
              ))}
            </ol>
          )}
          {moreActive?.status === "error" && (
            <p role="alert" className="text-xs text-destructive">
              {moreActive.message}
            </p>
          )}
          {active.page.next_before !== null && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={disabled || moreActive?.status === "loading"}
              onClick={() => void loadMore()}
            >
              {moreActive?.status === "loading" ? (
                <>
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  載入更多中…
                </>
              ) : moreActive?.status === "error" ? (
                "重試載入更多"
              ) : (
                "載入更多發言"
              )}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
