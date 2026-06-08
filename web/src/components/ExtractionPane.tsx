import { useEffect, useMemo, useState } from "react";
import { FileCode2, FolderOpen, Play, ShieldCheck, Wrench, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import type { ExtractionRun, ExtractionTool } from "@/types";

type PreviewState =
  | { status: "loading"; path: string }
  | { status: "loaded"; path: string; name: string; content: string; truncated: boolean; ext: string }
  | { status: "unpreviewable"; path: string; name: string; size: number }
  | { status: "error"; path: string; message: string };

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function PreviewPanel({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  const title = preview.status === "loading" ? preview.path.split("/").pop() : preview.status !== "error" ? preview.name : "预览出错";

  let body: React.ReactNode;
  if (preview.status === "loading") {
    body = <p className="p-6 text-[12px] text-neutral-400">加载中…</p>;
  } else if (preview.status === "error") {
    body = <p className="p-6 text-[12px] text-red-500">{preview.message}</p>;
  } else if (preview.status === "unpreviewable") {
    body = <p className="p-6 text-[12px] text-neutral-400">该文件类型不支持预览（{(preview.size / 1024).toFixed(1)} KB）</p>;
  } else {
    const { content, truncated, ext } = preview;
    const trimmed = truncated ? content + "\n\n…（文件过大，已截断）" : content;
    if (ext === ".md" || ext === ".markdown") {
      body = (
        <div className="overflow-auto p-4">
          {truncated && <p className="mb-3 rounded bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">文件较大，已截断前 2 MB 预览。</p>}
          <Markdown>{trimmed}</Markdown>
        </div>
      );
    } else if (ext === ".csv") {
      const rows = content.split(/\r?\n/).filter((r) => r.trim());
      const maxPreviewRows = 100;
      const isCsvTruncated = rows.length > maxPreviewRows || truncated;
      const displayRows = rows.slice(0, maxPreviewRows);
      const header = displayRows.length > 0 && displayRows[0] ? parseCsvLine(displayRows[0]) : [];
      const bodyRows = displayRows.slice(1).map(r => parseCsvLine(r));
      body = (
        <div className="overflow-auto p-4">
          <table className="w-full text-left text-[11.5px] whitespace-nowrap">
            <thead className="text-neutral-500 border-b border-neutral-200 dark:border-neutral-700">
              <tr>{header.map((h, i) => <th key={i} className="pb-1.5 pr-4 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {bodyRows.map((row, i) => (
                <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                  {row.map((cell, j) => <td key={j} className="py-1.5 pr-4">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {isCsvTruncated && <p className="mt-3 rounded bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">表格较大，仅渲染前 100 行预览。</p>}
        </div>
      );
    } else if (ext === ".json") {
      let pretty = content;
      try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep raw */ }
      body = (
        <div className="overflow-auto text-[11.5px] leading-5">
          {truncated && <p className="m-4 rounded bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">文件较大，已截断。</p>}
          <SyntaxHighlighter language="json" style={oneDark} customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}>
            {pretty}
          </SyntaxHighlighter>
        </div>
      );
    } else {
      body = <pre className="overflow-auto p-4 text-[11.5px] leading-5">{trimmed}</pre>;
    }
  }

  return (
    <aside className="flex min-h-0 w-[46%] shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <span className="min-w-0 truncate font-mono text-[11.5px] text-neutral-600 dark:text-neutral-300" title={title ?? ""}>{title}</span>
        <button onClick={onClose} className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto text-[12px] text-neutral-700 dark:text-neutral-300">
        {body}
      </div>
    </aside>
  );
}

type ColumnSpec = { key: string; label: string };

const TOOL_COLUMNS: Record<string, ColumnSpec[]> = {
  "extract-tmall-profile": [
    { key: "crowdName", label: "人群" },
    { key: "totalTags", label: "标签数" },
    { key: "matchRate", label: "匹配率" },
  ],
  "extract-xhs-insight": [
    { key: "crowdName", label: "人群" },
    { key: "totalTags", label: "标签数" },
    { key: "matchRate", label: "匹配率" },
  ],
  "phone-cleaner": [
    { key: "totalRows", label: "原始行" },
    { key: "validPhones", label: "有效号" },
    { key: "uniquePhones", label: "去重号" },
  ],
  "extract-sycm-member": [
    { key: "pageTitle", label: "页面" },
    { key: "coreMetricCount", label: "核心指标" },
    { key: "assetCount", label: "资产分层" },
    { key: "overviewMetricCount", label: "复购指标" },
    { key: "goodsRowCount", label: "商品排行" },
  ],
};

const DEFAULT_COLUMNS: ColumnSpec[] = [];

function headersFor(tool: { id: string; resultColumns?: Array<{ key: string; label: string }> } | null): ColumnSpec[] {
  if (tool?.resultColumns && tool.resultColumns.length > 0) return tool.resultColumns;
  return (tool && TOOL_COLUMNS[tool.id]) ?? DEFAULT_COLUMNS;
}

function cellsFor(result: Record<string, unknown>, tool: { id: string; resultColumns?: Array<{ key: string; label: string }> } | null): string[] {
  const cols = headersFor(tool);
  return cols.map((c) => {
    const v = result[c.key];
    return v == null || v === "" ? "-" : String(v);
  });
}

export function ExtractionPane({ workspaceId }: { workspaceId: string | null }) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [params, setParams] = useState<Record<string, string | number | boolean>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const tool = useMemo(() => tools.find((item) => item.id === toolId) ?? null, [toolId, tools]);

  useEffect(() => {
    api.listExtractionTools()
      .then((items) => {
        setTools(items);
        setToolId((current) => current || items[0]?.id || "");
      })
      .catch((err) => setError(String(err)));
  }, []);

  const pickPath = async (kind: "input" | "output", mode: "file" | "dir") => {
    setError("");
    try {
      const { path } = await api.pickLocalPath(mode);
      if (kind === "input") setInputPath(path);
      else setOutputPath(path);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    if (toolId) {
      const cached = localStorage.getItem(`pi-xanthil:tool-params:${toolId}`);
      if (cached) {
        try { setParams(JSON.parse(cached) as Record<string, string | number | boolean>); } catch { /* ignore */ }
      } else {
        setParams({});
      }
    }
  }, [toolId]);

  const updateParams = (newParams: Record<string, string | number | boolean>) => {
    setParams(newParams);
    if (toolId) localStorage.setItem(`pi-xanthil:tool-params:${toolId}`, JSON.stringify(newParams));
  };

  const execute = async () => {
    if (!tool || !inputPath || !outputPath) return;
    if ((tool.riskLevel === "L2" || tool.riskLevel === "L3") && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setRunning(true);
    setError("");
    setRun(null);
    setPreview(null);
    try {
      setRun(await api.runExtractionTool(tool.id, inputPath, outputPath, params, workspaceId ?? undefined));
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  const openPreview = async (filePath: string, outputRoot: string) => {
    setPreview({ status: "loading", path: filePath });
    try {
      const result = await api.previewExtractionFile(filePath, outputRoot);
      if (!result.previewable) {
        setPreview({ status: "unpreviewable", path: filePath, name: result.name, size: result.size });
      } else {
        const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
        setPreview({ status: "loaded", path: filePath, name: result.name, content: result.content!, truncated: result.truncated, ext });
      }
    } catch (err) {
      setPreview({ status: "error", path: filePath, message: String(err) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              <FileCode2 className="h-4 w-4" /> 数据提取
            </h1>
            <p className="mt-1 text-[12.5px] text-neutral-500">使用已注册的本地 Python 工具提取 HTML 等文档，生成规范化 Markdown 或表格数据。</p>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> 本地执行边界</div>
            <p className="mt-1">原始文档不会发送到 LLM。后端只允许运行注册表中的工具，输入与输出路径均由你明确选择。</p>
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="flex items-center gap-2 px-1 text-[12px] font-semibold"><Wrench className="h-3.5 w-3.5" /> 已注册工具</h2>
              <div className="mt-2 space-y-1.5">
                {tools.map((item) => (
                  <button key={item.id} onClick={() => setToolId(item.id)} className={`w-full rounded-md border px-3 py-2 text-left text-[12px] ${item.id === toolId ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}>
                    <span className="block font-medium">{item.name}</span>
                    <span className={`mt-1 block text-[10px] ${item.id === toolId ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500"}`}>v{item.version} · {item.input.accept.join(", ")}</span>
                  </button>
                ))}
                {tools.length === 0 && <p className="px-1 py-4 text-[12px] text-neutral-400">暂无已注册工具</p>}
              </div>
            </aside>

            <main className="space-y-4">
              <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-[13px] font-semibold">{tool?.name ?? "请选择工具"}</h2>
                <p className="mt-1 text-[12px] text-neutral-500">{tool?.description}</p>
                {tool && <p className="mt-2 font-mono text-[11px] text-neutral-400">{tool.id} · {tool.runtime} · 输出 {tool.output.join(", ")}</p>}
                {tool?.riskLevel && (
                  <p className="mt-1 text-[11px]">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium",
                      tool.riskLevel === "L0" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
                      tool.riskLevel === "L1" && "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
                      tool.riskLevel === "L2" && "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
                      tool.riskLevel === "L3" && "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
                    )}>
                      风险等级 {tool.riskLevel}
                    </span>
                    {tool.allowedUse && <span className="ml-2 text-neutral-500">适用: {tool.allowedUse}</span>}
                  </p>
                )}
                {tool?.forbiddenUse && (
                  <p className="mt-1 text-[11px] text-red-500">禁止: {tool.forbiddenUse}</p>
                )}
              </section>

              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-[13px] font-semibold">执行配置</h2>
                <label className="block text-[12px]"><span className="font-medium">输入 HTML 文件或目录</span><div className="mt-1.5 flex gap-2"><input value={inputPath} readOnly placeholder="请选择本地输入路径" className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] dark:border-neutral-700" /><button onClick={() => void pickPath("input", "file")} className="rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700">选择文件</button><button onClick={() => void pickPath("input", "dir")} className="rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700">选择目录</button></div></label>
                <label className="block text-[12px]"><span className="font-medium">输出目录</span><div className="mt-1.5 flex gap-2"><input value={outputPath} readOnly placeholder="请选择本地产物目录" className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] dark:border-neutral-700" /><button onClick={() => void pickPath("output", "dir")} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700"><FolderOpen className="h-3.5 w-3.5" /> 选择目录</button></div></label>

                {tool?.parameters && tool.parameters.length > 0 && (
                  <div className="my-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                    <h3 className="mb-3 text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">可选参数</h3>
                    <div className="grid gap-3">
                      {tool.parameters.map((param) => (
                        <label key={param.name} className="block text-[12px]">
                          <span className="font-medium">{param.label} {param.required && <span className="text-red-500">*</span>}</span>
                          {param.description && <span className="ml-2 text-[11px] text-neutral-400">{param.description}</span>}
                          <div className="mt-1.5">
                            {param.type === "boolean" ? (
                              <input 
                                type="checkbox" 
                                checked={!!(params[param.name] ?? param.default ?? false)} 
                                onChange={(e) => updateParams({ ...params, [param.name]: e.target.checked })} 
                              />
                            ) : param.type === "select" ? (
                              <select 
                                className="w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] dark:border-neutral-700" 
                                value={String(params[param.name] ?? param.default ?? "")} 
                                onChange={(e) => updateParams({ ...params, [param.name]: e.target.value })}
                              >
                                {param.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : (
                              <input 
                                type={param.type === "number" ? "number" : "text"} 
                                className="w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] dark:border-neutral-700" 
                                value={String(params[param.name] ?? param.default ?? "")} 
                                onChange={(e) => updateParams({ ...params, [param.name]: param.type === "number" ? Number(e.target.value) : e.target.value })} 
                              />
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <button disabled={!tool || !inputPath || !outputPath || running} onClick={() => void execute()} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"><Play className="h-3.5 w-3.5" /> {running ? "正在本地提取..." : confirming ? "确认执行" : "开始本地提取"}</button>
                {confirming && (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-[11px] dark:border-amber-900/50 dark:bg-amber-950/30">
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      确认执行「{tool?.name}」？风险等级 {tool?.riskLevel || "L2"}
                    </p>
                    <p className="mt-1 text-amber-600 dark:text-amber-400">
                      工具将在本地运行 Python 脚本，读取输入文件并写入输出目录。请确保输入路径不包含敏感明细数据。
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => void execute()} className="rounded bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700">确认执行</button>
                      <button onClick={() => setConfirming(false)} className="rounded border border-amber-300 px-2.5 py-1 text-amber-700 dark:border-amber-700 dark:text-amber-400">取消</button>
                    </div>
                  </div>
                )}
              </section>

              {run && (
                <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">执行结果</h2><span className="text-[11px] text-neutral-500">成功 {run.success} · 失败 {run.failed}</span></div>
                  <div className="mt-3 overflow-auto">
                    <table className="w-full whitespace-nowrap text-left text-[12px]">
                      <thead className="text-neutral-500">
                        <tr>
                          <th className="pb-1.5 pr-3">文件</th>
                          {headersFor(tool).map((h) => <th key={h.key} className="pb-1.5 pr-3">{h.label}</th>)}
                          <th className="pb-1.5">产物</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.results.map((result) => (
                          <tr key={result.file} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className="py-2 pr-3 font-mono">{result.file}</td>
                            {cellsFor(result, tool).map((cell, i) => <td key={i} className="pr-3">{cell}</td>)}
                            <td>
                              {result.error
                                ? <span className="text-red-500">{result.error}</span>
                                : result.outputs.map((path) => (
                                  <button
                                    key={path}
                                    onClick={() => void openPreview(path, outputPath)}
                                    className={`mr-2 block max-w-[28rem] truncate text-left font-mono text-[11px] hover:underline ${preview?.path === path ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
                                    title={path}
                                  >
                                    {path.split("/").pop()}
                                  </button>
                                ))
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details className="mt-3"><summary className="cursor-pointer text-[12px] text-neutral-500">执行日志</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[11px] leading-5 dark:bg-neutral-950">{run.stdout}{run.stderr}</pre></details>
                </section>
              )}
            </main>
          </div>
        </div>
      </div>

      {preview && (
        <PreviewPanel preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
