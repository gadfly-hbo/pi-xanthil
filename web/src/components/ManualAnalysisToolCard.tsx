import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, FileText, Loader2, Play, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ExtractionRun, ExtractionTool, ToolParameter, WorkspacePath } from "@/types";

type ParamValue = string | number | boolean;
type ParamState = Record<string, ParamValue>;

interface Props {
  sessionId: string | null;
  workspaceId: string | null;
  onBackflow: (text: string) => void;
  embedded?: boolean;
  preset?: {
    toolId?: string;
    inputPath?: string;
    params?: Record<string, string | number | boolean>;
    nonce: number;
  } | null;
}

function categoryOf(tool: ExtractionTool): "ingestion" | "analysis" {
  return tool.category === "analysis" ? "analysis" : "ingestion";
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

export function ManualAnalysisToolCard({ sessionId, workspaceId, onBackflow, embedded = false, preset = null }: Props) {
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [inputFiles, setInputFiles] = useState<WorkspacePath[]>([]);
  const [reportDir, setReportDir] = useState<WorkspacePath | null>(null);
  const [toolId, setToolId] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [params, setParams] = useState<ParamState>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [backflowText, setBackflowText] = useState("");

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === toolId) ?? null, [tools, toolId]);

  async function reload() {
    if (!workspaceId || !sessionId) {
      setTools([]);
      setInputFiles([]);
      setReportDir(null);
      setInputPath("");
      setOutputPath("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [allTools, workspacePaths, reportPaths] = await Promise.all([
        api.listExtractionTools(),
        api.listWorkspacePaths(workspaceId),
        api.listSessionPaths(sessionId, "report"),
      ]);
      const analysisTools = allTools.filter((tool) => categoryOf(tool) === "analysis");
      const files = workspacePaths.filter(isToolInputPath);
      const dir = reportPaths.find((path) => path.kind === "dir" && path.status !== "missing") ?? null;
      setTools(analysisTools);
      setInputFiles(files);
      setReportDir(dir);
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
  }, [workspaceId, sessionId]);

  useEffect(() => {
    setParams(initialParams(selectedTool));
    setRun(null);
    setBackflowText("");
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
      setError("当前 session 未配置 report 输出目录");
      return;
    }
    setRunning(true);
    setError("");
    setRun(null);
    setBackflowText("");
    try {
      const result = await api.runAnalysisTool(selectedTool.id, {
        workspaceId,
        inputPath,
        outputPath,
        params: normalizeParams(selectedTool, params),
      });
      const summary = formatRunSummary(selectedTool, inputPath, outputPath, result);
      setRun(result);
      setBackflowText(summary);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  function sendBackflow() {
    const text = backflowText.trim();
    if (!text) return;
    onBackflow(text);
    setRun(null);
    setBackflowText("");
  }

  const disabledReason = !workspaceId
    ? "先选择工作区"
    : !sessionId
      ? "先选择会话"
    : tools.length === 0
      ? "暂无 analysis 工具"
      : inputFiles.length === 0
        ? "暂无 draw_data / clean_data 文件"
        : !reportDir
          ? "当前 session 未配置 report 输出目录"
          : "";

  return (
    <div className={cn(
      embedded ? "h-full" : "rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950",
    )}>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => void reload()}
          disabled={loading || running}
          title="刷新工具和路径"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">analysis 工具</span>
            <select
              value={toolId}
              onChange={(event) => setToolId(event.target.value)}
              disabled={loading || running || tools.length === 0}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {tools.length === 0 && <option value="">暂无 analysis 工具</option>}
              {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name} · {tool.id}</option>)}
            </select>
          </label>

          {selectedTool && (
            <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{selectedTool.name}</div>
              <div className="mt-1 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">{selectedTool.description}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-neutral-500">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">analysis</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{selectedTool.input.accept.join(", ")}</span>
              </div>
            </div>
          )}

          {(selectedTool?.parameters?.length ?? 0) > 0 && (
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
          )}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
              <FileText className="h-3.5 w-3.5" /> 输入数据文件
            </span>
            <select
              value={inputPath}
              onChange={(event) => setInputPath(event.target.value)}
              disabled={loading || running || inputFiles.length === 0}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {inputFiles.length === 0 && <option value="">暂无 draw_data / clean_data 文件</option>}
              {inputFiles.map((file) => <option key={file.id} value={file.path}>{file.folder} · {basename(file.path)}</option>)}
            </select>
          </label>
          {inputPath && <div className="break-all rounded-md bg-white px-2 py-1.5 font-mono text-[10.5px] text-neutral-400 dark:bg-neutral-900">{inputPath}</div>}

          <div>
            <span className="text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">report 输出目录</span>
            <div className="mt-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
              {reportDir ? basename(reportDir.path) : "未配置 report 目录"}
            </div>
          </div>
          {outputPath && <div className="break-all rounded-md bg-white px-2 py-1.5 font-mono text-[10.5px] text-neutral-400 dark:bg-neutral-900">{outputPath}</div>}

          <button
            onClick={() => void runTool()}
            disabled={running || loading || Boolean(disabledReason)}
            title={disabledReason || "运行分析工具"}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "运行中" : "运行工具"}
          </button>
          {disabledReason && <div className="text-[11.5px] leading-4 text-neutral-400">{disabledReason}</div>}
        </div>
      </div>

      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {run && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
            <span>运行完成</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">成功 {run.success}</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800">失败 {run.failed}</span>
          </div>
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
        </div>
      )}
    </div>
  );
}
