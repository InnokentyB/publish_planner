import Markdown from 'markdown-to-jsx'

type ContentMarkupRendererProps = {
    content?: string | null
    contentType?: 'markdown' | 'html' | 'auto'
    title?: string
    emptyMessage?: string
    className?: string
}

function inferContentType(content: string, explicitType?: 'markdown' | 'html' | 'auto') {
    if (explicitType && explicitType !== 'auto') {
        return explicitType
    }

    if (/<[a-z][\s\S]*>/i.test(content)) {
        return 'html'
    }

    return 'markdown'
}

function buildHtmlDocument(content: string) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        --text: #172033;
        --muted: #576079;
        --border: rgba(61, 71, 109, 0.14);
        --accent: #333697;
        --surface: #ffffff;
        --soft: #f5f7fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 32px;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--surface);
        line-height: 1.7;
      }

      h1, h2, h3, h4, h5, h6 {
        color: var(--text);
        line-height: 1.15;
        margin: 0 0 0.9em;
      }

      h1 {
        font-size: 2rem;
      }

      h2 {
        font-size: 1.55rem;
        margin-top: 1.8em;
      }

      h3 {
        font-size: 1.25rem;
        margin-top: 1.5em;
      }

      p, ul, ol, blockquote, pre, table {
        margin: 0 0 1.1em;
      }

      a {
        color: var(--accent);
      }

      ul, ol {
        padding-left: 1.4rem;
      }

      blockquote {
        border-left: 3px solid var(--accent);
        padding-left: 1rem;
        color: var(--muted);
      }

      code {
        background: var(--soft);
        border-radius: 0.5rem;
        padding: 0.15rem 0.4rem;
        font-size: 0.92em;
      }

      pre {
        background: #101522;
        color: #eef2ff;
        border-radius: 1rem;
        padding: 1rem 1.1rem;
        overflow: auto;
      }

      pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }

      img {
        max-width: 100%;
        height: auto;
        display: block;
        border-radius: 1rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 0.7rem 0.8rem;
        text-align: left;
      }
    </style>
  </head>
  <body>${content}</body>
</html>`
}

export default function ContentMarkupRenderer({
    content,
    contentType = 'auto',
    title = 'content-preview',
    emptyMessage = 'No content loaded yet.',
    className = ''
}: ContentMarkupRendererProps) {
    const safeContent = content?.trim() || ''

    if (!safeContent) {
        return (
            <div className={`rounded-[1.5rem] bg-white/70 px-5 py-6 text-sm italic text-on-surface-variant ${className}`}>
                {emptyMessage}
            </div>
        )
    }

    const resolvedType = inferContentType(safeContent, contentType)

    if (resolvedType === 'html') {
        return (
            <div className={`rounded-[1.5rem] overflow-hidden border border-outline-variant/10 bg-white ${className}`}>
                <iframe
                    title={title}
                    sandbox=""
                    srcDoc={buildHtmlDocument(safeContent)}
                    className="w-full min-h-[520px] bg-white"
                />
            </div>
        )
    }

    return (
        <div className={`rounded-[1.5rem] bg-white px-6 py-6 ${className}`}>
            <div className="prose prose-slate max-w-none prose-headings:font-headline prose-headings:font-black prose-headings:tracking-tight prose-p:leading-7 prose-p:text-on-surface prose-strong:text-on-surface prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-primary prose-blockquote:text-on-surface-variant prose-li:marker:text-primary prose-code:rounded prose-code:bg-surface-container-low prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.92em] prose-pre:rounded-[1.25rem] prose-pre:bg-[#101522] prose-pre:text-[#eef2ff]">
                <Markdown>{safeContent}</Markdown>
            </div>
        </div>
    )
}
