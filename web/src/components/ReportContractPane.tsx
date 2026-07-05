import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Loader2,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDisplayPath } from "@/lib/pathDisplay";
import type { ContractAutoFixResult, ContractReviewResult } from "@/lib/api";
import type { ReportContractContext } from "@/lib/api/engine";
import { useBusinessRequirementContexts, type BusinessRequirementContextScope } from "./useBusinessRequirementContexts";
import type { FolderScope } from "@/tabs/types";

interface Props {
  scope: FolderScope;
  workspaceId: string | null;
  selectedReportPath?: { pathId: number; relPath: string } | null;
  onNavigateToBusinessRequirement: () => void;
  onNavigateToReportReview: () => void;
}

function isConfirmedJsonPath(path: string): boolean {
  return /(^|\/)business_requirements\/[^/]*-确认需求-[^/]*\.json$/.test(path);
}

function isFrameworkJsonPath(path: string): boolean {
  return /(^|\/)business_requirements\/[^/]*-分析框架-[^/]*\.json$/.test(path);
}

function contractSourceFromJsonPath(jsonPath: string): { requirementJsonPath: string } | { frameworkJsonPath: string } {
  return isConfirmedJsonPath(jsonPath)
    ? { requirementJsonPath: jsonPath }
    : { frameworkJsonPath: jsonPath };
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "未知";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const SCENE_LABEL: Record<string, string> = {
  daily: "日常",
  topic: "专题",
  recurring: "重复",
};

export function ReportContractPane({ scope, workspaceId, selectedReportPath, onNavigateToBusinessRequirement }: Props) {
  const hookScope: BusinessRequirementContextScope | null = useMemo(() => {
    if (!scope) return null;
    if (scope.type === "workspace") return { type: "workspace", workspaceId: scope.workspaceId };
    if (scope.type === "session") return { type: "session", sessionId: scope.sessionId };
    return { type: "flow", flowId: scope.flowId };
  }, [scope]);

  const { contexts, selectedId, setSelectedId, loading: versionsLoading } = useBusinessRequirementContexts(hookScope);

  const contractVersions = useMemo(
    () => contexts.filter((item) => isConfirmedJsonPath(item.jsonPath) || isFrameworkJsonPath(item.jsonPath)),
    [contexts],
  );

  const [contract, setContract] = useState<ReportContractContext | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState("");
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageResult, setCoverageResult] = useState<ContractReviewResult | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [revisionResult, setRevisionResult] = useState<ContractAutoFixResult | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState("");

  const selectedVersion = useMemo(
    () => contractVersions.find((item) => item.id === selectedId) ?? null,
    [contractVersions, selectedId],
  );

  // Auto-select the first contract version when none is selected.
  useEffect(() => {
    if (!selectedId && contractVersions.length > 0) {
      const first = contractVersions[0];
      if (first) setSelectedId(first.id);
    }
  }, [selectedId, contractVersions, setSelectedId]);

  const fetchContract = useCallback(async () => {
    if (!workspaceId || !selectedVersion) {
      setContract(null);
      return;
    }
    setContractLoading(true);
    setContractError("");
    try {
      const body = isConfirmedJsonPath(selectedVersion.jsonPath)
        ? { pathId: selectedVersion.pathId, requirementJsonPath: selectedVersion.jsonPath }
        : { pathId: selectedVersion.pathId, frameworkJsonPath: selectedVersion.jsonPath };
      const result = await api.getReportContractContext(workspaceId, body);
      setContract(result.context ?? null);
    } catch (err) {
      setContract(null);
      setContractError(String(err));
    } finally {
      setContractLoading(false);
    }
  }, [workspaceId, selectedVersion]);

  useEffect(() => {
    void fetchContract();
  }, [fetchContract]);

  const runCoverageReview = useCallback(async () => {
    if (!selectedReportPath || !contract || !selectedVersion) return;
    setCoverageLoading(true);
    setCoverageError("");
    setCoverageResult(null);
    setRevisionResult(null);
    setRevisionError("");
    try {
      const contractSource = contractSourceFromJsonPath(selectedVersion.jsonPath);
      const result = await api.contractReview(selectedReportPath.pathId, selectedReportPath.relPath, undefined, contractSource);
      setCoverageResult(result);
      setShowCoverage(true);
    } catch (err) {
      setCoverageError(String(err));
    } finally {
      setCoverageLoading(false);
    }
  }, [selectedReportPath, contract, selectedVersion]);

  const runContractRevision = useCallback(async () => {
    if (!selectedReportPath || !coverageResult || !selectedVersion) return;
    setRevisionLoading(true);
    setRevisionError("");
    setRevisionResult(null);
    try {
      const contractSource = contractSourceFromJsonPath(selectedVersion.jsonPath);
      const result = await api.contractAutoFix(selectedReportPath.pathId, selectedReportPath.relPath, undefined, coverageResult, undefined, contractSource);
      setRevisionResult(result);
    } catch (err) {
      setRevisionError(String(err));
    } finally {
      setRevisionLoading(false);
    }
  }, [selectedReportPath, coverageResult, selectedVersion]);

  // Clear coverage results when selected report changes.
  useEffect(() => {
    setCoverageResult(null);
    setCoverageError("");
    setRevisionResult(null);
    setRevisionError("");
  }, [selectedReportPath?.pathId, selectedReportPath?.relPath]);

  if (!workspaceId || !scope) {
    return (
      <ContractShell>
        <p className="px-1 py-3 text-[12.5px] text-neutral-400 dark:text-neutral-500">
          请先选择工作区后查看报告契约。
        </p>
      </ContractShell>
    );
  }

  if (versionsLoading) {
    return (
      <ContractShell>
        <p className="flex items-center gap-1.5 px-1 py-3 text-[12.5px] text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在读取业务需求版本...
        </p>
      </ContractShell>
    );
  }

  if (contractVersions.length === 0) {
    return (
      <ContractShell>
        <div className="px-1 py-3">
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
            当前报告输出路径下暂无业务需求或分析框架版本。
          </p>
          <p className="mt-1 text-[12px] text-neutral-400 dark:text-neutral-500">
            选择业务需求/报告框架后可按契约审查。
          </p>
          <button
            onClick={onNavigateToBusinessRequirement}
            className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            去业务需求模块
          </button>
        </div>
      </ContractShell>
    );
  }

  return (
    <ContractShell>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">契约版本</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-[200px] max-w-[420px] rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {contractVersions.map((item) => {
            const kindTag = isConfirmedJsonPath(item.jsonPath) ? "确认需求" : "分析框架";
            return (
              <option key={item.id} value={item.id}>
                [{kindTag}] {item.label}
              </option>
            );
          })}
        </select>
      </div>

      {contractError && (
        <p className="mx-1 mb-2 rounded bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {contractError}
        </p>
      )}

      {contractLoading ? (
        <p className="flex items-center gap-1.5 px-1 py-3 text-[12.5px] text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在读取报告契约...
        </p>
      ) : contract ? (
        <ContractDetail
          contract={contract}
          showCoverage={showCoverage}
          onToggleCoverage={() => setShowCoverage((v) => !v)}
          onNavigateToBusinessRequirement={onNavigateToBusinessRequirement}
          selectedReportPath={selectedReportPath}
          coverageResult={coverageResult}
          coverageLoading={coverageLoading}
          coverageError={coverageError}
          revisionResult={revisionResult}
          revisionLoading={revisionLoading}
          revisionError={revisionError}
          onRunCoverage={runCoverageReview}
          onRunRevision={runContractRevision}
        />
      ) : (
        !contractError && (
          <p className="px-1 py-3 text-[12.5px] text-neutral-400">
            {selectedVersion ? "未读取到报告契约。" : "请在上方选择契约版本。"}
          </p>
        )
      )}
    </ContractShell>
  );
}

function ContractShell({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-2 border-b border-neutral-100 pb-2 dark:border-neutral-800">
        <ScrollText className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
        <h3 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">报告契约</h3>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">— 展示当前报告受约束的业务需求/报告框架</span>
      </div>
      {children}
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-center dark:border-neutral-800 dark:bg-neutral-800/40">
      <p className="text-[16px] font-semibold leading-tight text-neutral-800 dark:text-neutral-200">{value}</p>
      <p className="text-[10.5px] text-neutral-400">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: "covered" | "partial" | "missing" }) {
  if (status === "covered") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  if (status === "partial") return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />;
}

function ContractDetail({
  contract,
  showCoverage,
  onToggleCoverage,
  onNavigateToBusinessRequirement,
  selectedReportPath,
  coverageResult,
  coverageLoading,
  coverageError,
  revisionResult,
  revisionLoading,
  revisionError,
  onRunCoverage,
  onRunRevision,
}: {
  contract: ReportContractContext;
  showCoverage: boolean;
  onToggleCoverage: () => void;
  onNavigateToBusinessRequirement: () => void;
  selectedReportPath?: { pathId: number; relPath: string } | null;
  coverageResult: ContractReviewResult | null;
  coverageLoading: boolean;
  coverageError: string;
  revisionResult: ContractAutoFixResult | null;
  revisionLoading: boolean;
  revisionError: string;
  onRunCoverage: () => void;
  onRunRevision: () => void;
}) {
  const kindLabel = contract.source.kind === "confirmed_requirement" ? "确认需求" : "分析框架";
  const sectionCount = contract.sections.length;
  const totalKeyQuestions = contract.sections.reduce((sum, s) => sum + s.keyQuestions.length, 0);
  const totalRequiredEvidence = contract.sections.reduce((sum, s) => sum + s.requiredEvidence.length, 0);

  return (
    <div className="space-y-3 px-1">
      {contract.fallback && (
        <p className="flex items-center gap-1.5 rounded bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          当前使用默认报告框架（未找到结构化章节定义），建议回业务需求模块生成完整分析框架。
        </p>
      )}

      <div className="rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" />
            {kindLabel}
          </span>
          <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{contract.projectName}</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] text-neutral-500 dark:text-neutral-400 sm:grid-cols-2">
          <div>
            <span className="text-neutral-400">文件：</span>
            <span className="font-mono">{basename(contract.source.jsonPath)}</span>
          </div>
          {contract.source.scene && (
            <div>
              <span className="text-neutral-400">场景：</span>
              {SCENE_LABEL[contract.source.scene] ?? contract.source.scene}
            </div>
          )}
          {contract.source.confirmedAt && (
            <div>
              <span className="text-neutral-400">确认时间：</span>
              {formatTime(contract.source.confirmedAt)}
            </div>
          )}
        </div>
      </div>

      {contract.objective && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">报告目标</p>
          <p className="mt-0.5 text-[12.5px] text-neutral-700 dark:text-neutral-300">{contract.objective}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <CountCard label="章节" value={sectionCount} />
        <CountCard label="必答问题" value={totalKeyQuestions} />
        <CountCard label="证据要求" value={totalRequiredEvidence} />
        <CountCard label="待答问题" value={contract.openQuestions.length} />
        <CountCard label="风险" value={contract.risks.length} />
        <CountCard label="确认事实" value={contract.confirmedFacts.length} />
      </div>

      {sectionCount > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">章节要求摘要</p>
          <div className="space-y-1.5">
            {contract.sections.map((section, idx) => (
              <div key={idx} className="rounded border border-neutral-100 bg-white px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-neutral-400">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">{section.title}</span>
                </div>
                {section.purpose && (
                  <p className="ml-5 mt-0.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">{section.purpose}</p>
                )}
                <div className="ml-5 mt-1 flex flex-wrap gap-2 text-[10.5px] text-neutral-400">
                  <span>{section.keyQuestions.length} 个必答问题</span>
                  <span>·</span>
                  <span>{section.requiredEvidence.length} 项证据</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCoverage && (
        <div className="rounded-md border border-neutral-100 p-2.5 dark:border-neutral-800">
          <p className="mb-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">契约覆盖检查</p>
          {coverageLoading ? (
            <p className="flex items-center gap-1.5 text-[12px] text-neutral-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在审查报告与契约的覆盖关系...
            </p>
          ) : coverageError ? (
            <p className="text-[12px] text-red-500">{coverageError}</p>
          ) : coverageResult ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-medium text-neutral-700 dark:text-neutral-200">覆盖率评分</span>
                <span className="font-mono text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">{coverageResult.totalScore}</span>
                <span className="text-neutral-400">/ 100</span>
              </div>
              {coverageResult.coverageSummary && (
                <p className="text-[11.5px] text-neutral-600 dark:text-neutral-400">{coverageResult.coverageSummary}</p>
              )}
              {/* Section results */}
              {coverageResult.sectionResults.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10.5px] font-medium text-neutral-400">章节覆盖</p>
                  {coverageResult.sectionResults.map((finding, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11.5px]">
                      <StatusIcon status={finding.status} />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-neutral-700 dark:text-neutral-200">{finding.title}</span>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{finding.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Evidence gaps */}
              {coverageResult.evidenceGaps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10.5px] font-medium text-amber-600 dark:text-amber-400">缺证据 ({coverageResult.evidenceGaps.length})</p>
                  {coverageResult.evidenceGaps.map((finding, idx) => (
                    <div key={idx} className="text-[11px] text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium">{finding.title}</span>: {finding.detail}
                    </div>
                  ))}
                </div>
              )}
              {/* Unsupported claims */}
              {coverageResult.unsupportedClaims.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10.5px] font-medium text-red-600 dark:text-red-400">无依据断言 ({coverageResult.unsupportedClaims.length})</p>
                  {coverageResult.unsupportedClaims.map((finding, idx) => (
                    <div key={idx} className="text-[11px] text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium">{finding.title}</span>: {finding.detail}
                    </div>
                  ))}
                </div>
              )}
              {/* Open question misuse */}
              {coverageResult.openQuestionMisuse.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10.5px] font-medium text-orange-600 dark:text-orange-400">误用待确认问题 ({coverageResult.openQuestionMisuse.length})</p>
                  {coverageResult.openQuestionMisuse.map((finding, idx) => (
                    <div key={idx} className="text-[11px] text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium">{finding.title}</span>: {finding.detail}
                    </div>
                  ))}
                </div>
              )}
              {/* Rewrite plan */}
              {coverageResult.rewritePlan.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10.5px] font-medium text-blue-600 dark:text-blue-400">建议修订</p>
                  <ul className="list-disc pl-3 text-[11px] text-neutral-600 dark:text-neutral-400">
                    {coverageResult.rewritePlan.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {revisionError && (
                <p className="rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-400">{revisionError}</p>
              )}
              {revisionResult && (
                <div className="rounded border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[11.5px] text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
                  <p className="font-medium">已生成契约修订版本</p>
                  <p className="mt-0.5 font-mono text-[11px] break-all" title={revisionResult.path}>{formatDisplayPath(revisionResult.path)}</p>
                  <p className="mt-1 text-[11px]">评分变化：{revisionResult.originalScore} → {revisionResult.revisedScore}（Δ {revisionResult.coverageDelta}）</p>
                  {revisionResult.unresolvedGaps.length > 0 && (
                    <p className="mt-1 text-[11px]">未解决缺口：{revisionResult.unresolvedGaps.slice(0, 3).join("；")}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-neutral-400">
              {selectedReportPath ? "点击「按框架审查」按钮开始自动化覆盖检查。" : "请先在左侧选择报告文件，再点击审查。"}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
        <button
          onClick={onRunCoverage}
          disabled={!selectedReportPath || coverageLoading}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {coverageLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          按框架审查
        </button>
        <button
          onClick={onRunRevision}
          disabled={!selectedReportPath || !coverageResult || coverageLoading || revisionLoading}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[12px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          title={coverageResult ? "基于当前契约审查结果生成修订版报告" : "请先按框架审查，再生成修订版"}
        >
          {revisionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          按审查结果修订
        </button>
        <button
          onClick={onToggleCoverage}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {showCoverage ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ClipboardCheck className="h-3.5 w-3.5" />
          {showCoverage ? "收起覆盖清单" : "查看契约覆盖"}
        </button>
        <button
          onClick={onNavigateToBusinessRequirement}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          回业务需求模块修订
        </button>
      </div>
    </div>
  );
}
