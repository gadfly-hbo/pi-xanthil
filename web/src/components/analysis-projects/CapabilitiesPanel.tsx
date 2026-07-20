import { CheckCircle2, XCircle, Cpu, Database } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CapabilitiesResponse, AgentHarnessCapability } from "@/types/analysis-projects";

interface Props {
  data: CapabilitiesResponse;
}

function HarnessCapabilityRow({ cap }: { cap: AgentHarnessCapability }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <Database className="h-3 w-3 shrink-0 text-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
        {cap.displayName}
      </span>
      <span className="shrink-0 text-[10px] text-neutral-400">{cap.contractVersion}</span>
      <span className={cn(
        "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
        cap.readOnly
          ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
      )}>
        {cap.readOnly ? "只读" : "读写"}
      </span>
    </div>
  );
}

export function CapabilitiesPanel({ data }: Props) {
  const { data: caps } = data;
  const engineAvailable = caps.engine.status === "available";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <h3 className="mb-3 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
        系统能力
      </h3>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Engine status */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
            <Cpu className="h-3.5 w-3.5" />
            分析引擎
          </div>
          <div className="flex items-center gap-2">
            {engineAvailable ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-neutral-400" />
            )}
            <span className={cn(
              "text-[12px]",
              engineAvailable ? "text-green-600 dark:text-green-400" : "text-neutral-500",
            )}>
              {engineAvailable ? "可用" : "不可用"}
            </span>
            {caps.engine.adapter && (
              <span className="text-[10px] text-neutral-400">({caps.engine.adapter})</span>
            )}
            {caps.engine.reason && (
              <span className="text-[10px] text-neutral-400">{caps.engine.reason}</span>
            )}
          </div>
        </div>

        {/* Upload capabilities */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
            上传限制
          </div>
          <div className="text-[11px] text-neutral-500">
            <div>最大: {(caps.upload.maxBytes / (1024 * 1024)).toFixed(0)} MB</div>
            <div className="mt-0.5">格式: {caps.upload.allowedMediaTypes.join(", ")}</div>
          </div>
        </div>

        {/* Source capabilities */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
            用户数据来源
          </div>
          {caps.sourceCapabilities.user.map((s, i) => (
            <div key={i} className="text-[11px] text-neutral-500">
              {s.kind} · {s.scope} · {s.artifactKind}
            </div>
          ))}
        </div>

        {/* AgentHarness capabilities */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
            <Database className="h-3.5 w-3.5" />
            AgentHarness 能力
          </div>
          {caps.sourceCapabilities.agentHarness.length === 0 ? (
            <p className="text-[11px] text-neutral-400">暂无已注册能力</p>
          ) : (
            <div className="max-h-48 overflow-auto">
              {caps.sourceCapabilities.agentHarness.map((cap) => (
                <HarnessCapabilityRow key={cap.capabilityId} cap={cap} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Schema versions */}
      <div className="mt-3 text-[10px] text-neutral-400">
        API v{caps.apiVersion} · Schema {caps.supportedSchemaVersions.join(", ")} · App v{caps.appVersion}
      </div>
    </div>
  );
}
