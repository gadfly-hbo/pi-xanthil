import type { ReactNode } from "react";

export function ResultCard({ title, status, meta, children, collapsible = false }: {
  title: ReactNode;
  status: "success" | "failed";
  meta?: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return <details className="rounded border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium"><span>{title}</span><span className={`ml-2 ${status === "success" ? "text-emerald-600" : "text-red-600"}`}>{status}</span>{meta && <span className="ml-2 font-normal text-muted-foreground">{meta}</span>}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>;
  }
  return <article className="space-y-2 rounded border border-border p-3 text-xs">
    <div className="flex items-start justify-between gap-3 font-medium">
      <span>{title}</span>
      <span className={status === "success" ? "text-emerald-600" : "text-red-600"}>{status}</span>
    </div>
    {meta && <div className="text-muted-foreground">{meta}</div>}
    {children}
  </article>;
}
