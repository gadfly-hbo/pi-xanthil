import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={
        className ??
        "prose prose-sm prose-neutral max-w-none break-words dark:prose-invert prose-headings:mb-2 prose-headings:mt-4 prose-h2:text-lg prose-h3:text-base prose-p:my-2 prose-pre:my-3 prose-ol:my-2 prose-ul:my-2 prose-table:my-0 prose-hr:my-4"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const isBlock = className?.includes("language-");
            return isBlock && match ? (
              <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: "0.5rem", fontSize: "12.5px" }}>
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[0.85em] dark:bg-neutral-800" {...props}>
                {children}
              </code>
            );
          },
          table: (props) => <table className="border-collapse text-[13px]" {...props} />,
          th: (props) => <th className="border border-neutral-200 px-2 py-1 text-left dark:border-neutral-700" {...props} />,
          td: (props) => <td className="border border-neutral-200 px-2 py-1 dark:border-neutral-700" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
