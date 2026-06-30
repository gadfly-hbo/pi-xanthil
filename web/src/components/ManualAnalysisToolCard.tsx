import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CheckCircle2, FileText, FolderOpen, Loader2, Play, RefreshCw, Search, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ExtractionRun, ExtractionTool, ToolParameter, WorkspacePath } from "@/types";

type ParamValue = string | number | boolean;
type ParamState = Record<string, ParamValue>;

interface Props {
  sessionId: string | null;
  workspaceId: string | null;
  onBackflow?: (text: string) => void;
  embedded?: boolean;
  mode?: "chat" | "aggregate";
  scope?: ToolScope;
  onRegistered?: () => void;
  preset?: {
    toolId?: string;
    inputPath?: string;
    params?: Record<string, string | number | boolean>;
    nonce: number;
  } | null;
}

type ToolScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string }
  | null;

type RegistrationResult = {
  registered: string[];
  skipped: string[];
  failed: Array<{ path: string; error: string }>;
};

function categoryOf(tool: ExtractionTool): "ingestion" | "analysis" {
  return tool.category === "analysis" ? "analysis" : "ingestion";
}

function toolSearchText(tool: ExtractionTool): string {
  return [
    tool.id,
    tool.name,
    tool.description,
    tool.runtime,
    tool.riskLevel ?? "",
    tool.allowedUse ?? "",
    tool.forbiddenUse ?? "",
    tool.failureHandling ?? "",
    ...(tool.tags ?? []),
    ...tool.input.accept,
    ...tool.input.modes,
    ...tool.output,
  ].join(" ").toLowerCase();
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

function defaultParamValue(param: ToolParameter): ParamValue {
  if (param.default !== undefined) return param.default;
  if (param.type === "boolean") return false;
  return "";
}

function initialParams(tool: ExtractionTool | null): ParamState {
  const next: ParamState = {};
  for (const param of tool?.parameters ?? []) next[param.name] = defaultParamValue(param);
  return next;
}

function normalizeParams(tool: ExtractionTool, values: ParamState): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const param of tool.parameters ?? []) {
    const value = values[param.name];
    if (value === undefined || value === "") continue;
    if (param.type === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      params[param.name] = parsed;
    } else {
      params[param.name] = value;
    }
  }
  return params;
}

function validateParams(tool: ExtractionTool, values: ParamState): string {
  for (const param of tool.parameters ?? []) {
    const value = values[param.name];
    if (param.required && (value === undefined || value === "")) return `参数「${param.label || param.name}」必填`;
    if (param.type === "number" && value !== undefined && value !== "" && !Number.isFinite(Number(value))) {
      return `参数「${param.label || param.name}」必须是数字`;
    }
  }
  return "";
}

function formatRunSummary(tool: ExtractionTool, inputPath: string, outputPath: string, run: ExtractionRun): string {
  const outputs = run.results.flatMap((result) => result.outputs ?? []);
  const outputLines = outputs.length > 0
    ? outputs.map((path) => `- ${path}`).join("\n")
    : "- 无产物路径返回";
  const lines = [
    `已手动运行分析工具：${tool.name} (${tool.id})`,
    "",
    "输入数据：",
    inputPath,
    "",
    "输出目录：",
    outputPath,
    "",
    "运行结果：",
    `- 成功：${run.success}`,
    `- 失败：${run.failed}`,
    `- runId：${run.runId}`,
  ];
  if (run.error) {
    lines.push("", "错误摘要：", run.error);
  }
  lines.push(
    "",
    "产物：",
    outputLines,
    "",
    "请基于以上工具结果继续分析。",
  );
  return lines.join("\n");
}

function ParamField({ param, value, onChange }: { param: ToolParameter; value: ParamValue | undefined; onChange: (value: ParamValue) => void }) {
  const label = param.label || param.name;
  const baseClass = "w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
        {label}
        {param.required && <span className="text-rose-500">*</span>}
      </span>
      {param.type === "boolean" ? (
        <span className="mt-1 flex h-8 items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-900">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="text-neutral-500 dark:text-neutral-400">启用</span>
        </span>
      ) : param.type === "select" ? (
        <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${baseClass} mt-1`}>
          <option value="">请选择</option>
          {(param.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          type={param.type === "number" ? "number" : param.type === "date" ? "date" : "text"}
          value={String(value ?? "")}
          onChange={(event) => onChange(param.type === "number" ? event.target.value : event.target.value)}
          className={`${baseClass} mt-1`}
        />
      )}
      {param.description && <span className="mt-1 block text-[10.5px] leading-4 text-neutral-400">{param.description}</span>}
    </label>
  );
}

function isToolInputPath(path: WorkspacePath): boolean {
  return (path.folder === "draw_data" || path.folder === "clean_data")
    && path.kind === "file"
    && path.status !== "missing";
}

function isCleanOutputDir(path: WorkspacePath): boolean {
  return path.folder === "clean_data" && path.kind === "dir" && path.status !== "missing";
}

function isLikelyFile(path: string): boolean {
  return /\/[^/]+\.[^/.]+$/.test(path.replace(/\\/g, "/"));
}

function uniqueOutputPaths(run: ExtractionRun): string[] {
  return Array.from(new Set(run.results.flatMap((result) => result.outputs ?? []).filter(isLikelyFile)));
}

async function listScopePaths(scope: ToolScope, workspaceId: string, folder?: "draw_data" | "clean_data" | "report"): Promise<WorkspacePath[]> {
  if (!scope || scope.type === "workspace") return api.listWorkspacePaths(scope?.workspaceId ?? workspaceId, folder);
  if (scope.type === "session") return api.listSessionPaths(scope.sessionId, folder);
  return api.listFlowPaths(scope.flowId, folder);
}

async function addScopePath(scope: ToolScope, workspaceId: string, folder: "clean_data", path: string): Promise<WorkspacePath> {
  if (!scope || scope.type === "workspace") return api.addWorkspacePath(scope?.workspaceId ?? workspaceId, folder, path, "file");
  if (scope.type === "session") return api.addSessionPath(scope.sessionId, folder, path, "file");
  return api.addFlowPath(scope.flowId, folder, path, "file");
}

function taskScopeOptions(scope: ToolScope): { sessionId?: string; flowId?: string } {
  if (scope?.type === "session") return { sessionId: scope.sessionId };
  if (scope?.type === "flow") return { flowId: scope.flowId };
  return {};
}

export function ManualAnalysisToolCard({ sessionId, workspaceId, onBackflow, embedded = false, mode = "chat", scope = null, onRegistered, preset = null }: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [inputFiles, setInputFiles] = useState<WorkspacePath[]>([]);
  const [outputDir, setOutputDir] = useState<WorkspacePath | null>(null);
  const [toolId, setToolId] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [params, setParams] = useState<ParamState>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [backflowText, setBackflowText] = useState("");
  const [registration, setRegistration] = useState<RegistrationResult | null>(null);
  const [query, setQuery] = useState("");

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === toolId) ?? null, [tools, toolId]);
  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter((tool) => toolSearchText(tool).includes(needle));
  }, [query, tools]);
  const outputFolderLabel = mode === "aggregate" ? "clean_data" : "report";

  async function reload() {
    if (!workspaceId || (mode === "chat" && !sessionId)) {
      setTools([]);
      setInputFiles([]);
      setOutputDir(null);
      setInputPath("");
      setOutputPath("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [allTools, workspacePaths, reportPaths] = await Promise.all([
        api.listExtractionTools(),
        listScopePaths(scope, workspaceId),
        mode === "aggregate"
          ? listScopePaths(scope, workspaceId, "clean_data")
          : api.listSessionPaths(sessionId ?? "", "report"),
      ]);
      const analysisTools = allTools.filter((tool) => categoryOf(tool) === "analysis");
      const files = workspacePaths.filter(isToolInputPath);
      const dir = mode === "aggregate"
        ? reportPaths.find(isCleanOutputDir) ?? null
        : reportPaths.find((path) => path.kind === "dir" && path.status !== "missing") ?? null;
      setTools(analysisTools);
      setInputFiles(files);
      setOutputDir(dir);
      setToolId((current) => analysisTools.some((tool) => tool.id === current) ? current : analysisTools[0]?.id ?? "");
      setInputPath((current) => files.some((path) => path.path === current) ? current : files[0]?.path ?? "");
      setOutputPath(dir?.path ?? "");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [workspaceId, sessionId, scope?.type, scope?.type === "workspace" ? scope.workspaceId : "", scope?.type === "session" ? scope.sessionId : "", scope?.type === "flow" ? scope.flowId : "", mode]);

  useEffect(() => {
    setParams(initialParams(selectedTool));
    setRun(null);
    setBackflowText("");
    setRegistration(null);
  }, [selectedTool?.id]);

  useEffect(() => {
    if (!preset) return;
    if (preset.toolId && selectedTool?.id !== preset.toolId) {
      setToolId(preset.toolId);
      return;
    }
    if (preset.inputPath) setInputPath(preset.inputPath);
    if (preset.params) {
      setParams((current) => ({ ...current, ...preset.params }));
    }
    setRun(null);
    setBackflowText("");
    setRegistration(null);
  }, [preset?.nonce, selectedTool?.id]);

  async function runTool() {
    if (!workspaceId || !selectedTool || running) return;
    const paramError = validateParams(selectedTool, params);
    if (paramError) {
      setError(paramError);
      return;
    }
    if (!inputPath) {
      setError("请选择 draw_data 或 clean_data 文件");
      return;
    }
    if (!outputPath) {
      setError(`当前范围未配置 ${outputFolderLabel} 输出目录`);
      return;
    }
    setRunning(true);
    setError("");
    setRun(null);
    setBackflowText("");
    setRegistration(null);
    try {
      const result = await api.runAnalysisTool(selectedTool.id, {
        workspaceId,
        inputPath,
        outputPath,
        params: normalizeParams(selectedTool, params),
        caller: mode === "aggregate" ? "command" : "chat",
        targetKind: scope?.type ?? (sessionId ? "session" : "workspace"),
        targetId: scope?.type === "workspace" ? scope.workspaceId : scope?.type === "session" ? scope.sessionId : scope?.type === "flow" ? scope.flowId : sessionId ?? workspaceId,
      });
      const summary = formatRunSummary(selectedTool, inputPath, outputPath, result);
      setRun(result);
      setBackflowText(summary);
      if (mode === "aggregate") {
        const outputs = uniqueOutputPaths(result);
        const existing = new Set((await listScopePaths(scope, workspaceId, "clean_data")).map((path) => path.path));
        const registered: string[] = [];
        const skipped: string[] = [];
        const failed: Array<{ path: string; error: string }> = [];
        for (const path of outputs) {
          if (existing.has(path)) {
            skipped.push(path);
            continue;
          }
          try {
            await addScopePath(scope, workspaceId, "clean_data", path);
            registered.push(path);
            existing.add(path);
          } catch (err) {
            failed.push({ path, error: String(err) });
          }
        }
        setRegistration({ registered, skipped, failed });
        if (registered.length > 0) onRegistered?.();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function pickOutputDir() {
    setError("");
    try {
      const { path } = await api.pickLocalPath("dir", { folder: "clean_data", ...taskScopeOptions(scope) });
      setOutputPath(path);
      setOutputDir(null);
    } catch (err) {
      setError(String(err));
    }
  }

  function sendBackflow() {
    const text = backflowText.trim();
    if (!text || !onBackflow) return;
    onBackflow(text);
    setRun(null);
    setBackflowText("");
  }

  const disabledReason = !workspaceId
    ? "先选择工作区"
    : mode === "chat" && !sessionId
      ? "先选择会话"
    : tools.length === 0
      ? "暂无 analysis 工具"
      : inputFiles.length === 0
        ? "暂无 draw_data / clean_data 文件"
        : !outputPath
          ? `当前范围未配置 ${outputFolderLabel} 输出目录`
          : "";

  return (
    <div className={cn(
      embedded ? "h-full" : "rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950",
    )}>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 px-1 text-[12px] font-semibold">
              <Wrench className="h-3.5 w-3.5" /> 分析工具
            </h2>
            <button
              onClick={() => void reload()}
              disabled={loading || running}
              title="刷新工具和路径"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-[11px] dark:border-neutral-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称 / id / 格式"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-neutral-400"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label="清空搜索"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-neutral-400">仅显示 category=analysis 的本地工具，共 {tools.length} 个。</p>
          <div className="mt-2 space-y-1.5">
            {filteredTools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setToolId(tool.id)}
                disabled={running}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors disabled:opacity-60",
                  tool.id === toolId
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800",
                )}
              >
                <span className="block truncate font-medium">{tool.name}</span>
                <span className={cn(
                  "mt-1 block truncate text-[10px]",
                  tool.id === toolId ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500",
                )}>
                  {tool.id} · {tool.input.accept.join(", ")}
                </span>
              </button>
            ))}
            {filteredTools.length === 0 && <p className="px-1 py-4 text-[12px] text-neutral-400">{tools.length === 0 ? "暂无 analysis 工具" : "当前搜索下没有 analysis 工具"}</p>}
          </div>
        </aside>

        <main className="space-y-4">
          {selectedTool && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{selectedTool.name}</h2>
              <p className="mt-1 text-[12px] leading-5 text-neutral-500">{selectedTool.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-neutral-500">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">analysis</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{selectedTool.input.accept.join(", ")}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{selectedTool.id}</span>
                {selectedTool.riskLevel && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{selectedTool.riskLevel}</span>}
              </div>
              {selectedTool.allowedUse && <p className="mt-2 text-[11px] leading-4 text-neutral-500">适用: {selectedTool.allowedUse}</p>}
              {selectedTool.forbiddenUse && <p className="mt-1 text-[11px] leading-4 text-red-500">禁止: {selectedTool.forbiddenUse}</p>}
            </section>
          )}

          <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-[13px] font-semibold">执行配置</h2>
            <label className="block text-[12px]">
              <span className="flex items-center gap-1.5 font-medium">
                <FileText className="h-3.5 w-3.5" /> 输入数据文件
              </span>
              <select
                value={inputPath}
                onChange={(event) => setInputPath(event.target.value)}
                disabled={loading || running || inputFiles.length === 0}
                className="mt-1.5 w-full rounded border border-neutral-200 bg-transparent px-2.5 py-2 text-[12px] outline-none disabled:opacity-50 dark:border-neutral-700"
              >
                {inputFiles.length === 0 && <option value="">暂无 draw_data / clean_data 文件</option>}
                {inputFiles.map((file) => <option key={file.id} value={file.path}>{file.folder} · {basename(file.path)}</option>)}
              </select>
            </label>
            {inputPath && <div className="break-all rounded-md bg-neutral-50 px-2.5 py-2 font-mono text-[11px] text-neutral-500 dark:bg-neutral-950">{inputPath}</div>}

            <div>
              <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">{outputFolderLabel} 输出目录</span>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={outputPath}
                  readOnly
                  placeholder={`请选择 ${outputFolderLabel} 输出目录`}
                  className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2.5 py-2 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
                />
                <button
                  onClick={() => void pickOutputDir()}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2.5 text-[12px] text-neutral-700 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> 选择目录
                </button>
              </div>
            </div>
            {outputPath && !outputDir && <div className="text-[11px] leading-4 text-neutral-400">已手动选择输出目录；产物登记仍按 clean_data 规则校验。</div>}

            {(selectedTool?.parameters?.length ?? 0) > 0 && (
              <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <h3 className="mb-3 text-[12px] font-semibold text-neutral-700 dark:text-neutral-300">参数</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedTool?.parameters?.map((param) => (
                    <ParamField
                      key={param.name}
                      param={param}
                      value={params[param.name]}
                      onChange={(value) => setParams((current) => ({ ...current, [param.name]: value }))}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => void runTool()}
                disabled={running || loading || Boolean(disabledReason)}
                title={disabledReason || "运行分析工具"}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "运行中" : "运行工具"}
              </button>
              {disabledReason && <div className="text-[11.5px] leading-4 text-neutral-400">{disabledReason}</div>}
            </div>
          </section>

          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

          {run && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[13px] font-semibold">执行结果</h2>
                <span className="text-[11px] text-neutral-500">成功 {run.success} · 失败 {run.failed}</span>
              </div>
              {mode === "aggregate" && registration && (
                <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5" /> 聚合数据登记完成</div>
                  <div className="mt-1 text-[11px] leading-4">
                    新增 {registration.registered.length} 个，已存在 {registration.skipped.length} 个，失败 {registration.failed.length} 个。
                  </div>
                  {registration.failed.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px] text-amber-700 dark:text-amber-200">
                      {registration.failed.map((item) => <li key={item.path} className="break-all">{item.path}: {item.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {mode === "chat" && (
                <>
                  <textarea
                    value={backflowText}
                    onChange={(event) => setBackflowText(event.target.value)}
                    rows={8}
                    className="mt-2 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 font-mono text-[12px] leading-5 outline-none dark:border-neutral-700"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setRun(null);
                        setBackflowText("");
                      }}
                      className="rounded-md px-3 py-1.5 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      关闭结果
                    </button>
                    <button
                      onClick={sendBackflow}
                      disabled={!backflowText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      发送到对话
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
