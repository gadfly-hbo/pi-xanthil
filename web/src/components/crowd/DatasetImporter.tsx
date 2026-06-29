import { useRef, useState, useCallback } from "react";
import { Upload, Loader2, AlertTriangle, Download, FileSpreadsheet, Shield, Check, Loader } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { CrowdDataset } from "@/types";

interface Props {
  workspaceId: string;
  onImported: (dataset: CrowdDataset) => void;
}

type ImportChannel = "detail" | "aggregate";

interface WorkflowStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  error?: string;
}

const TEMPLATE_BUTTONS: { label: string; fileName: string; isDemo: boolean; channel: ImportChannel }[] = [
  { label: "下载明细模板", fileName: "template-detail.csv", isDemo: false, channel: "detail" },
  { label: "下载聚合模板", fileName: "template-aggregate.csv", isDemo: false, channel: "aggregate" },
  { label: "试用明细示例", fileName: "demo-detail.csv", isDemo: true, channel: "detail" },
  { label: "试用聚合示例", fileName: "demo-aggregate.csv", isDemo: true, channel: "aggregate" },
];

const STEP_TIMEOUT_MS = {
  template: 30_000,
  import: 60_000,
  segment: 30_000,
} as const;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}超时，请稍后刷新列表确认是否已完成，或重试。`));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function formatImportError(error: unknown, isAggregate: boolean): string {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: unknown };
      if (typeof parsed.error === "string") {
        const missing = /missing required v2 column: "([^"]+)"/.exec(parsed.error);
        if (missing?.[1]) {
          return isAggregate
            ? `聚合上传缺少必填列 ${missing[1]}。请使用「下载聚合模板」的表头，或确认第一列是 segment_name。`
            : `上传文件缺少必填列 ${missing[1]}。`;
        }
        return parsed.error;
      }
    } catch {
      // Fall through to raw message.
    }
  }
  return raw || "导入失败";
}

function Stepper({ steps }: { steps: WorkflowStep[] }) {
  const doneCount = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const failedSteps = steps.filter((step) => step.status === "failed" && step.error);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="font-medium">工作流进度</span>
        <span className="text-muted-foreground/60">({doneCount}/{total})</span>
      </div>
      <div className="flex gap-1">
        {steps.map((step, i) => (
          <div key={step.id} className="flex-1 flex items-center gap-1">
            <div className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
              step.status === "done" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
              step.status === "running" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
              step.status === "failed" && "bg-destructive/10 text-destructive",
              step.status === "pending" && "bg-muted text-muted-foreground",
            )}>
              {step.status === "done" ? <Check className="h-3 w-3" /> : step.status === "running" ? <Loader className="h-3 w-3 animate-spin" /> : i + 1}
            </div>
            <span className={cn(
              "text-[11px] truncate",
              step.status === "failed" && "text-destructive",
            )}>
              {step.label}
            </span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-border" />}
          </div>
        ))}
      </div>
      {failedSteps.length > 0 && (
        <div className="pt-1 text-[11px] leading-4 text-destructive">
          {failedSteps.map((step) => (
            <div key={step.id}>{step.label}：{step.error}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DatasetImporter({ workspaceId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState<ImportChannel>("detail");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  const updateStep = useCallback((id: string, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const runWorkflow = useCallback(async (file: File, isAggregate: boolean) => {
    setImporting(true);
    setError(null);

    // Detail: import produces the local aggregate summary; LLM generation is user-triggered after CSV inspection.
    const workflowSteps: WorkflowStep[] = [
      { id: "import", label: "导入", status: "pending" },
      ...(!isAggregate ? [{ id: "aggregate", label: "聚合", status: "pending" } as WorkflowStep] : []),
      { id: "segment", label: "分群", status: "pending" },
    ];
    setSteps(workflowSteps);

    let dataset: CrowdDataset | null = null;
    let activeStepId = "import";

    try {
      // Step 1: Import
      activeStepId = "import";
      updateStep("import", { status: "running" });
      if (isAggregate) {
        const result = await withTimeout(api.importCrowdAggregate(workspaceId, file), STEP_TIMEOUT_MS.import, "聚合导入");
        dataset = result.dataset;
        updateStep("import", { status: "done" });
      } else {
        dataset = await withTimeout(api.importCrowdDataset(workspaceId, file), STEP_TIMEOUT_MS.import, "明细导入");
        updateStep("import", { status: "done" });
        updateStep("aggregate", { status: "running" });
        updateStep("aggregate", { status: "done" });
      }

      // Step 3: Default segment (for detail only; aggregate already has segments from import)
      if (!isAggregate) {
        activeStepId = "segment";
        updateStep("segment", { status: "running" });
        try {
          await withTimeout(api.createDefaultCrowdSegment(workspaceId, dataset.id), STEP_TIMEOUT_MS.segment, "分群创建");
          updateStep("segment", { status: "done" });
        } catch (err) {
          updateStep("segment", { status: "failed", error: formatImportError(err, isAggregate) || "分群创建失败" });
        }
      } else {
        // Aggregate: segments already created by import
        updateStep("segment", { status: "done" });
      }

      onImported(dataset);
    } catch (err) {
      const message = formatImportError(err, isAggregate);
      updateStep(activeStepId, { status: "failed", error: message });
      setError(message);
    } finally {
      setImporting(false);
    }
  }, [workspaceId, onImported, updateStep]);

  const doImport = useCallback(async (file: File) => {
    void runWorkflow(file, channel === "aggregate");
  }, [channel, runWorkflow]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void doImport(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void doImport(file);
  };

  const handleTemplateAction = useCallback(async (fileName: string, isDemo: boolean, tplChannel: ImportChannel) => {
    setImporting(true);
    setError(null);
    try {
      const resp = await withTimeout(api.getCrowdTemplate(fileName), STEP_TIMEOUT_MS.template, "模板下载");
      if (!resp.ok) throw new Error("download failed");
      const blob = await resp.blob();
      const file = new File([blob], fileName, { type: "text/csv" });
      if (isDemo) {
        void runWorkflow(file, tplChannel === "aggregate");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        setImporting(false);
      }
    } catch (err) {
      setError(formatImportError(err, tplChannel === "aggregate"));
      setImporting(false);
    }
  }, [runWorkflow]);

  const filteredTemplates = TEMPLATE_BUTTONS.filter((b) => b.channel === channel);

  return (
    <div className="space-y-3">
      {/* Channel toggle */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-input bg-muted/50 p-0.5">
          <button
            onClick={() => setChannel("detail")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-medium transition-colors",
              channel === "detail"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            明细上传
          </button>
          <button
            onClick={() => setChannel("aggregate")}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-medium transition-colors",
              channel === "aggregate"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            聚合上传
          </button>
        </div>
        <span className="text-xs text-muted-foreground">上传后先检查聚合结果，再手动生成画像</span>
      </div>

      {/* Aggregate security banner */}
      {channel === "aggregate" && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
          <Shield className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">聚合数据</span> · 不传敏感明细，导入后请在分群列表逐个点「生成画像」
          </span>
        </div>
      )}

      {/* Detail channel hint */}
      {channel === "detail" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Shield className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">原始行不进 LLM</span>，仅生成聚合摘要
          </span>
        </div>
      )}

      {/* Workflow stepper */}
      {steps.length > 0 && (
        <div className="rounded-md border bg-card p-3">
          <Stepper steps={steps} />
        </div>
      )}

      {/* Upload zone */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={importing}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-[13px] font-medium transition-colors",
          dragOver
            ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-neutral-300 text-neutral-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
          importing && "pointer-events-none opacity-50",
        )}
      >
        {importing ? (
          <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
        ) : (
          <Upload className="h-5 w-5" strokeWidth={1.75} />
        )}
        {importing ? "处理中..." : "拖拽 CSV / Excel 文件到此处，或点击选择"}
      </button>

      {/* Template buttons */}
      <div className="flex flex-wrap gap-2">
        {filteredTemplates.map((btn) => (
          <button
            key={btn.fileName}
            onClick={() => handleTemplateAction(btn.fileName, btn.isDemo, btn.channel)}
            disabled={importing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              btn.isDemo
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
            )}
          >
            {btn.isDemo ? (
              <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {btn.label}
          </button>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{error}</span>
        </div>
      )}
    </div>
  );
}
