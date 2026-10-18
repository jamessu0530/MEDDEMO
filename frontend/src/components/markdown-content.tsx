import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import "./markdown-content.css"

const components: Components = {
  a: ({ href, children, title }) => (
    <a
      href={href}
      title={title}
      target={href && /^(https?:)?\/\//i.test(href) ? "_blank" : undefined}
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="回覆表格"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
}

/** Render assistant replies consistently, including answers restored from history. */
export function MarkdownContent({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "markdown-content max-w-full min-w-0 text-sm leading-relaxed",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        skipHtml
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
