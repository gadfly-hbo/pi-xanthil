import { Archive, Download, Loader2 } from "lucide-react";
import type { EvaluationArchiveIndexItem } from "@/types";

export function ArchiveList({ archives, onDownload, onDownloadManifest, onDownloadZip, zipping = false, limit = 5 }: {
  archives: EvaluationArchiveIndexItem[];
  onDownload: (item: EvaluationArchiveIndexItem, format: "md" | "json") => void;
  onDownloadManifest: () => void;
  onDownloadZip?: () => void;
  zipping?: boolean;
  limit?: number;
}) {
  return <section className="mt-6">
    <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
      <Archive className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1">最近归档</span>
      <button type="button" disabled={archives.length === 0} onClick={onDownloadManifest} className={smallButtonClass}>manifest</button>
      {onDownloadZip && <button type="button" disabled={archives.length === 0 || zipping} onClick={onDownloadZip} className={smallButtonClass}>
        {zipping ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />} zip
      </button>}
    </div>
    <div className="mt-2 space-y-1">
      {archives.slice(0, limit).map((item) => <div key={item.baseName} className="rounded-md border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
        <div className="flex items-center gap-2"><span className="rounded bg-sky-50 px-1 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">{item.kind}</span><span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" title={item.evaluationId}>{item.evaluationId}</span></div>
        <div className="mt-1 truncate font-mono text-[10px] text-neutral-400" title={`${item.markdownRelPath} / ${item.jsonRelPath}`}>{item.markdownRelPath}</div>
        <div className="mt-2 flex gap-1"><button type="button" onClick={() => onDownload(item, "md")} className={fileButtonClass}>MD</button><button type="button" onClick={() => onDownload(item, "json")} className={fileButtonClass}>JSON</button></div>
      </div>)}
      {archives.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">还没有归档报告。</p>}
    </div>
  </section>;
}

const smallButtonClass = "inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";
const fileButtonClass = "rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
