import { useEffect, useMemo, useState } from "react";
import { FileCode2, FolderOpen, Play, ShieldCheck, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import type { ExtractionRun, ExtractionTool } from "@/types";

export function ExtractionPane() {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ExtractionRun | null>(null);
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

  const execute = async () => {
    if (!tool || !inputPath || !outputPath) return;
    setRunning(true);
    setError("");
    setRun(null);
    try {
      setRun(await api.runExtractionTool(tool.id, inputPath, outputPath));
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
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
            </section>

            <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[13px] font-semibold">执行配置</h2>
              <label className="block text-[12px]"><span className="font-medium">输入 HTML 文件或目录</span><div className="mt-1.5 flex gap-2"><input value={inputPath} readOnly placeholder="请选择本地输入路径" className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] dark:border-neutral-700" /><button onClick={() => void pickPath("input", "file")} className="rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700">选择文件</button><button onClick={() => void pickPath("input", "dir")} className="rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700">选择目录</button></div></label>
              <label className="block text-[12px]"><span className="font-medium">输出目录</span><div className="mt-1.5 flex gap-2"><input value={outputPath} readOnly placeholder="请选择本地产物目录" className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] dark:border-neutral-700" /><button onClick={() => void pickPath("output", "dir")} className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700"><FolderOpen className="h-3.5 w-3.5" /> 选择目录</button></div></label>
              <button disabled={!tool || !inputPath || !outputPath || running} onClick={() => void execute()} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"><Play className="h-3.5 w-3.5" /> {running ? "正在本地提取..." : "开始本地提取"}</button>
            </section>

            {run && <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">执行结果</h2><span className="text-[11px] text-neutral-500">成功 {run.success} · 失败 {run.failed}</span></div>
              <div className="mt-3 overflow-auto"><table className="w-full whitespace-nowrap text-left text-[12px]"><thead className="text-neutral-500"><tr><th className="pb-1.5">文件</th><th>人群</th><th>标签数</th><th>匹配率</th><th>产物</th></tr></thead><tbody>{run.results.map((result) => <tr key={result.file} className="border-t border-neutral-100 dark:border-neutral-800"><td className="py-2 pr-3 font-mono">{result.file}</td><td className="pr-3">{result.crowdName ?? "-"}</td><td className="pr-3">{result.totalTags ?? "-"}</td><td className="pr-3">{result.matchRate ?? "-"}</td><td>{result.error ? <span className="text-red-500">{result.error}</span> : result.outputs.map((path) => <span key={path} className="mr-2 block max-w-[32rem] truncate font-mono text-[11px] text-neutral-500" title={path}>{path}</span>)}</td></tr>)}</tbody></table></div>
              <details className="mt-3"><summary className="cursor-pointer text-[12px] text-neutral-500">执行日志</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[11px] leading-5 dark:bg-neutral-950">{run.stdout}{run.stderr}</pre></details>
            </section>}
          </main>
        </div>
      </div>
    </div>
  );
}
