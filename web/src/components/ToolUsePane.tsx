import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Play, ShieldAlert, Wrench, FlaskConical, RefreshCw, Ban } from "lucide-react";
import { api } from "@/lib/api";
import { useResumableTask } from "@/lib/resumableTask";
import type { ExtractionRun, ExtractionTool, ToolEvalCase, WorkspacePath } from "@/types";
import type { FolderScope } from "@/tabs/types";

interface Props {
  scope: FolderScope;
  workspaceId: string | null;
}

type ParamValue = string | number | boolean;

function scopeKey(scope: FolderScope): string {
  if (!scope) return "none";
  if (scope.type === "workspace") return "ws:" + scope.workspaceId;
  if (scope.type === "session") return "ss:" + scope.sessionId;
  return "fl:" + scope.flowId;
}

function listCleanDataPaths(scope: FolderScope): Promise<WorkspacePath[]> {
  if (!scope) return Promise.resolve([]);
  switch (scope.type) {
    case "workspace":
      return api.listWorkspacePaths(scope.workspaceId, "clean_data");
    case "session":
      return api.listSessionPaths(scope.sessionId, "clean_data");
    case "flow":
      return api.listFlowPaths(scope.flowId, "clean_data");
  }
}

function defaultParamValue(type: string, defVal: string | number | boolean | undefined): ParamValue {
  if (defVal !== undefined) return defVal;
  if (type === "boolean") return false;
  if (type === "number") return 0;
  return "";
}

export function ToolUsePane({ scope, workspaceId }: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState<string>("");
  const [loadError, setLoadError] = useState("");

  const [cleanPaths, setCleanPaths] = useState<WorkspacePath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [pathsError, setPathsError] = useState("");

  const [selectedInputPath, setSelectedInputPath] = useState<string>("");
  const [outputPath, setOutputPath] = useState<string>("");
  const [params, setParams] = useState<Record<string, ParamValue>>({});

  const [testCases, setTestCases] = useState<ToolEvalCase[] | null>(null);
  const [casesError, setCasesError] = useState("");
  const [casesOpen, setCasesOpen] = useState(false);

  const tool = useMemo(() => tools.find((t) => t.id === toolId) ?? null, [tools, toolId]);
  const scopeKeyStr = useMemo(() => scopeKey(scope), [scope]);

  const taskKey = "tool-use:" + (toolId || "none") + ":" + selectedInputPath;
  const runTask = useResumableTask<ExtractionRun>(taskKey);

  useEffect(() => {
    api
      .listExtractionTools()
      .then((items) => {
        setTools(items);
        setToolId((cur) => cur || items[0]?.id || "");
      })
      .catch((err) => setLoadError(String(err)));
  }, []);

  const reloadPaths = useCallback(async () => {
    setPathsLoading(true);
    setPathsError("");
    try {
      const items = await listCleanDataPaths(scope);
      setCleanPaths(items);
    } catch (err) {
      setPathsError(String(err));
      setCleanPaths([]);
    } finally {
      setPathsLoading(false);
    }
  }, [scopeKeyStr]);

  useEffect(() => {
    void reloadPaths();
  }, [reloadPaths]);

  useEffect(() => {
    if (!tool) {
      setParams({});
      return;
    }
    const next: Record<string, ParamValue> = {};
    for (const p of tool.parameters ?? []) {
      next[p.name] = defaultParamValue(p.type, p.default);
    }
    setParams(next);
    runTask.reset();
    setTestCases(null);
    setCasesError("");
    setCasesOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  useEffect(() => {
    if (selectedInputPath) return;
    if (cleanPaths.length > 0) {
      const first = cleanPaths[0];
      if (first) setSelectedInputPath(first.path);
    }
  }, [cleanPaths, selectedInputPath]);

  useEffect(() => {
    if (!toolId) return;
    const lsKey = "pi-xanthil:tool-use:output:" + scopeKeyStr + ":" + toolId;
    const cached = localStorage.getItem(lsKey);
    if (cached) setOutputPath(cached);
  }, [toolId, scopeKeyStr]);

  const updateOutputPath = (path: string) => {
    setOutputPath(path);
    if (toolId) {
      localStorage.setItem("pi-xanthil:tool-use:output:" + scopeKeyStr + ":" + toolId, path);
    }
  };

  const pickOutput = async () => {
    try {
      const { path } = await api.pickLocalPath("dir");
      updateOutputPath(path);
    } catch {
      /* user cancelled */
    }
  };

  const loadTestCases = async () => {
    if (!toolId) return;
    if (!casesOpen && testCases === null) {
      try {
        const result = await api.getToolTestCases(toolId);
        setTestCases(result.cases ?? []);
      } catch (err) {
        setCasesError(String(err));
        setTestCases([]);
      }
    }
    setCasesOpen((v) => !v);
  };

  const inputPathRegistered = cleanPaths.some((p) => p.path === selectedInputPath);
  const running = runTask.status === "running";
  const canRun = !!tool && !!selectedInputPath && inputPathRegistered && !!outputPath && !running;

  const execute = () => {
    if (!tool || !selectedInputPath || !outputPath) return;
    if (!cleanPaths.some((p) => p.path === selectedInputPath)) return;
    const cleanParams: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === "" || v === undefined) continue;
      cleanParams[k] = v;
    }
    void runTask.start(() =>
      api.runExtractionTool(tool.id, selectedInputPath, outputPath, cleanParams, workspaceId ?? undefined),
    );
  };

  const updateParam = (name: string, value: ParamValue) => {
    setParams((cur) => ({ ...cur, [name]: value }));
  };

  const run = runTask.data ?? null;
  const taskError = runTask.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <Wrench className="h-4 w-4" /> 计算工具 · tool-use
          </h1>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            手动试跑已注册的本地工具。输入数据仅允许从「聚合数据 clean_data」中选择；原始数据 draw_data 不可作为工具输入。
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <ShieldAlert className="h-4 w-4" /> 数据边界
          </div>
          <p className="mt-1">本面板零 LLM 调用。工具在本地执行，仅读取你选择的 clean_data 路径，写入你指定的输出目录。</p>
        </div>

        {loadError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {loadError}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="flex items-center gap-2 px-1 text-[12px] font-semibold">
              <Wrench className="h-3.5 w-3.5" /> 已注册工具
            </h2>
            <div className="mt-2 space-y-1.5">
              {tools.map((item) => {
                const active = item.id === toolId;
                return (
                  <button
                    key={item.id}
                    onClick={() => setToolId(item.id)}
                    className={
                      "w-full rounded-md border px-3 py-2 text-left text-[12px] " +
                      (active
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                        : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800")
                    }
                  >
                    <span className="block font-medium">{item.name}</span>
                    <span
                      className={
                        "mt-1 block text-[10px] " +
                        (active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500")
                      }
                    >
                      v{item.version} · {item.runtime} · {item.input.accept.join(", ")}
                    </span>
                  </button>
                );
              })}
              {tools.length === 0 && !loadError && (
                <p className="px-1 py-4 text-[12px] text-neutral-400">暂无已注册工具</p>
              )}
            </div>
          </aside>

          <main className="space-y-4">
            <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[13px] font-semibold">{tool?.name ?? "请选择工具"}</h2>
              <p className="mt-1 text-[12px] text-neutral-500">
                {tool?.description ?? "从左侧选择一个已注册的本地工具进行手动试跑。"}
              </p>
              {tool && (
                <p className="mt-2 font-mono text-[11px] text-neutral-400">
                  {tool.id} · {tool.runtime} · 输出 {tool.output.join(", ")}
                  {tool.timeoutMs ? " · 超时 " + tool.timeoutMs + "ms" : ""}
                </p>
              )}
              {tool?.allowedUse && (
                <p className="mt-1 text-[11px] text-neutral-500">适用：{tool.allowedUse}</p>
              )}
              {tool?.forbiddenUse && (
                <p className="mt-1 text-[11px] text-red-500">禁止：{tool.forbiddenUse}</p>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold">输入数据（仅 clean_data）</h2>
                <button
                  onClick={() => void reloadPaths()}
                  className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  disabled={pathsLoading}
                >
                  <RefreshCw className={"h-3 w-3 " + (pathsLoading ? "animate-spin" : "")} /> 刷新
                </button>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                <Ban className="h-3 w-3" /> draw_data 已被禁用，原始数据不可作为工具输入。
              </p>
              {pathsError && (
                <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {pathsError}
                </p>
              )}
              {cleanPaths.length === 0 && !pathsLoading && (
                <p className="rounded border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-[11.5px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/40">
                  当前作用域下尚未登记任何 clean_data 路径。请先在「探索 → clean_data」中添加。
                </p>
              )}
              <select
                className="w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11.5px] dark:border-neutral-700"
                value={selectedInputPath}
                onChange={(e) => setSelectedInputPath(e.target.value)}
                disabled={cleanPaths.length === 0}
              >
                <option value="">— 请选择 clean_data 路径 —</option>
                {cleanPaths.map((p) => (
                  <option key={p.id} value={p.path}>
                    [{p.kind === "dir" ? "dir" : "file"}] {p.path}
                  </option>
                ))}
              </select>
              {selectedInputPath && !inputPathRegistered && (
                <p className="text-[11px] text-red-500">所选路径不在当前 clean_data 列表中，无法执行。</p>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[13px] font-semibold">输出目录</h2>
              <div className="flex gap-2">
                <input
                  value={outputPath}
                  readOnly
                  placeholder="请选择本地产物目录"
                  className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] dark:border-neutral-700"
                />
                <button
                  onClick={() => void pickOutput()}
                  className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 text-[12px] dark:border-neutral-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> 选择目录
                </button>
              </div>
            </section>

            {tool?.parameters && tool.parameters.length > 0 && (
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-[13px] font-semibold">参数</h2>
                <div className="grid gap-3">
                  {tool.parameters.map((param) => (
                    <label key={param.name} className="block text-[12px]">
                      <span className="font-medium">
                        {param.label}
                        {param.required && <span className="ml-0.5 text-red-500">*</span>}
                      </span>
                      {param.description && (
                        <span className="ml-2 text-[11px] text-neutral-400">{param.description}</span>
                      )}
                      <div className="mt-1.5">
                        {param.type === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={Boolean(params[param.name])}
                            onChange={(e) => updateParam(param.name, e.target.checked)}
                          />
                        ) : param.type === "select" ? (
                          <select
                            className="w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] dark:border-neutral-700"
                            value={String(params[param.name] ?? "")}
                            onChange={(e) => updateParam(param.name, e.target.value)}
                          >
                            {param.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={param.type === "number" ? "number" : "text"}
                            className="w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] dark:border-neutral-700"
                            value={String(params[param.name] ?? "")}
                            onChange={(e) =>
                              updateParam(
                                param.name,
                                param.type === "number" ? Number(e.target.value) : e.target.value,
                              )
                            }
                          />
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <button
                disabled={!canRun}
                onClick={execute}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
              >
                <Play className="h-3.5 w-3.5" /> {running ? "正在执行..." : "执行工具"}
              </button>
              {taskError && (
                <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {taskError}
                </p>
              )}
            </section>

            {run && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold">执行结果（summary.json）</h2>
                  <span className="text-[11px] text-neutral-500">
                    成功 {run.success} · 失败 {run.failed}
                  </span>
                </div>
                {run.error && (
                  <p className="mt-2 text-[11.5px] text-red-500">summary.error: {run.error}</p>
                )}
                <div className="mt-3 overflow-auto">
                  <table className="w-full whitespace-nowrap text-left text-[12px]">
                    <thead className="text-neutral-500">
                      <tr>
                        <th className="pb-1.5 pr-3">文件</th>
                        <th className="pb-1.5 pr-3">产物</th>
                        <th className="pb-1.5">错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.results.map((r, idx) => (
                        <tr key={r.file + ":" + idx} className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="py-2 pr-3 font-mono text-[11px]">{r.file}</td>
                          <td className="py-2 pr-3">
                            {(r.outputs ?? []).map((o) => (
                              <div key={o} className="font-mono text-[11px] text-neutral-500" title={o}>
                                {o.split("/").pop()}
                              </div>
                            ))}
                          </td>
                          <td className="py-2 text-[11px] text-red-500">{r.error ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12px] text-neutral-500">执行日志</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[11px] leading-5 dark:bg-neutral-950">
                    {run.stdout}
                    {run.stderr}
                  </pre>
                </details>
              </section>
            )}

            {tool && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <button
                  onClick={() => void loadTestCases()}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 hover:underline dark:text-neutral-200"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  {casesOpen ? "收起测试用例" : "查看测试用例（只读）"}
                </button>
                {casesOpen && (
                  <div className="mt-3 space-y-2">
                    {casesError && (
                      <p className="text-[11.5px] text-red-500">{casesError}</p>
                    )}
                    {testCases && testCases.length === 0 && !casesError && (
                      <p className="text-[11.5px] text-neutral-400">该工具暂无测试用例。</p>
                    )}
                    {testCases && testCases.length > 0 && (
                      <ul className="space-y-1.5">
                        {testCases.map((c) => (
                          <li
                            key={c.id}
                            className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-800/40"
                          >
                            <div className="font-medium text-neutral-700 dark:text-neutral-200">
                              {c.name}
                              <span className="ml-2 font-mono text-[10.5px] text-neutral-400">{c.id}</span>
                            </div>
                            <div className="mt-1 font-mono text-[10.5px] text-neutral-500">输入：{c.inputPath}</div>
                            <div className="mt-0.5 text-[10.5px] text-neutral-500">期望：{c.expected.kind}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
