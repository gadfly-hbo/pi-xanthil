import type { ReactNode } from "react";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, History, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SkillRegistryEvalHistoryEntry, SkillRegistryRetestTrigger } from "@/types";

export interface ObservabilityDashboardData {
  activeCount: number;
  prodInjected: number;
  prodActivated: number;
  prodActivationRate: number | null;
  coveredCount: number;
  evalCovered: number;
  savedTokensTotal: number;
  baselineTokensTotal: number;
  variantTokensTotal: number;
  tokenSavingPct: number | null;
  regressionCount: number;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  dashboard: ObservabilityDashboardData;
  regressionSlugs: string[];
  history: SkillRegistryEvalHistoryEntry[];
  historyTotal: number;
  historyLoading: boolean;
  historySlug: string | null;
  onClearHistorySlug: () => void;
  onPickSlug: (slug: string) => void;
}

const TRIGGER_LABEL: Record<SkillRegistryRetestTrigger, string> = {
  manual_evaluate: "手动评测",
  version_bump: "版本变更",
  model_upgrade: "模型升级",
  retest_all_active: "批量重测",
};

function fmtPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return (v * 100).toFixed(1) + "%";
}
function fmtScore(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  return v.toFixed(2);
}
function fmtDeltaPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return sign + (v * 100).toFixed(1) + "pp";
}
function fmtDeltaScore(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(3);
}
function fmtTimeShort(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${hh}:${mm}`;
}

export function ObservabilityDashboard(props: Props) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <DashboardHeader open={props.open} onToggle={props.onToggle} dashboard={props.dashboard} />
      {props.open && <DashboardBody {...props} />}
    </div>
  );
}

function DashboardHeader(props: { open: boolean; onToggle: () => void; dashboard: ObservabilityDashboardData }) {
  const { open, onToggle, dashboard } = props;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
    >
      <div className="flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />
        <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">可观测面板</span>
        <span className="text-[10.5px] text-neutral-400">
          active {dashboard.activeCount} · 生产激活 {fmtPct(dashboard.prodActivationRate)}
        </span>
        {dashboard.regressionCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 py-0.5 text-[10px] text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
            <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
            回归 {dashboard.regressionCount}
          </span>
        )}
      </div>
      {open ? (
        <ChevronUp className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
      )}
    </button>
  );
}
function DashboardBody(props: Props) {
  const { dashboard, regressionSlugs } = props;
  const tokenColor =
    dashboard.savedTokensTotal > 0
      ? "text-emerald-700 dark:text-emerald-300"
      : dashboard.savedTokensTotal < 0
        ? "text-rose-700 dark:text-rose-300"
        : "text-neutral-800 dark:text-neutral-100";
  const tokenValue =
    dashboard.savedTokensTotal === 0
      ? "-"
      : (dashboard.savedTokensTotal > 0 ? "+" : "") + Math.round(dashboard.savedTokensTotal).toLocaleString();
  const tokenSuffix =
    dashboard.tokenSavingPct === null ? "" : `(${(dashboard.tokenSavingPct * 100).toFixed(1)}%)`;
  const regressionHint =
    regressionSlugs.length > 0
      ? `${regressionSlugs.slice(0, 3).join(", ")}${regressionSlugs.length > 3 ? " 等" : ""}`
      : "无回归";
  return (
    <div className="border-t border-neutral-100 px-3 py-3 dark:border-neutral-800">
      <div className="grid gap-2 md:grid-cols-3">
        <KpiCard
          icon={<Activity className="h-3 w-3" strokeWidth={1.75} />}
          label="生产激活率"
          value={fmtPct(dashboard.prodActivationRate)}
          suffix={`${dashboard.prodActivated}/${dashboard.prodInjected}`}
          hint={`覆盖 ${dashboard.coveredCount}/${dashboard.activeCount} 个 active skill`}
          hintTitle="active skill 在生产环境被注入并真正激活的整体比例。"
        />
        <KpiCard
          icon={<TrendingUp className="h-3 w-3" strokeWidth={1.75} />}
          label="评测期省 token"
          valueClassName={tokenColor}
          value={tokenValue}
          suffix={tokenSuffix}
          hint={`覆盖 ${dashboard.evalCovered}/${dashboard.activeCount} 个 active skill`}
          hintTitle="基于最近一次评测：baseline 与 variant(=该 skill) 的 avgTotalTokens 差求和。"
        />
        <KpiCard
          icon={<TrendingDown className="h-3 w-3" strokeWidth={1.75} />}
          label="回归 skill 数"
          valueClassName={dashboard.regressionCount > 0 ? "text-rose-700 dark:text-rose-300" : undefined}
          value={String(dashboard.regressionCount)}
          suffix={`/ ${dashboard.activeCount}`}
          hint={regressionHint}
          hintTitle="regressionStatus === 'regression' 的 active skill。"
        />
      </div>
      <TimelineSection
        history={props.history}
        historyTotal={props.historyTotal}
        historyLoading={props.historyLoading}
        historySlug={props.historySlug}
        onClearHistorySlug={props.onClearHistorySlug}
        onPickSlug={props.onPickSlug}
      />
    </div>
  );
}
function KpiCard(props: { icon: ReactNode; label: string; value: string; suffix?: string; hint: string; hintTitle?: string; valueClassName?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/50">
      <div className="flex items-center justify-between text-[10.5px] text-neutral-500">
        <span>{props.label}</span>
        {props.icon}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", props.valueClassName ?? "text-neutral-800 dark:text-neutral-100")}>
          {props.value}
        </span>
        {props.suffix && <span className="text-[10.5px] tabular-nums text-neutral-400">{props.suffix}</span>}
      </div>
      <div className="mt-0.5 text-[10.5px] text-neutral-400" title={props.hintTitle}>
        {props.hint}
      </div>
    </div>
  );
}

interface TimelineProps {
  history: SkillRegistryEvalHistoryEntry[];
  historyTotal: number;
  historyLoading: boolean;
  historySlug: string | null;
  onClearHistorySlug: () => void;
  onPickSlug: (slug: string) => void;
}

function TimelineSection(props: TimelineProps) {
  const { history, historyTotal, historyLoading, historySlug, onClearHistorySlug, onPickSlug } = props;
  const headerCount = historySlug
    ? `已筛选 ${historySlug}（${history.length} 条 / 共 ${historyTotal}）`
    : `最近 ${history.length} 条`;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
          <span className="text-[11.5px] font-medium text-neutral-700 dark:text-neutral-200">评测时间线</span>
          <span className="text-[10.5px] text-neutral-400">{headerCount}</span>
          {historyLoading && <span className="text-[10.5px] text-neutral-400">加载中…</span>}
        </div>
        {historySlug && (
          <button
            type="button"
            onClick={onClearHistorySlug}
            className="text-[10.5px] text-neutral-500 underline-offset-2 hover:underline"
          >
            清除筛选
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-neutral-200 px-3 py-4 text-center text-[10.5px] text-neutral-400 dark:border-neutral-800">
          暂无评测历史
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
          {history.map((h) => (
            <TimelineRow key={h.id} entry={h} onPickSlug={onPickSlug} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  entry: SkillRegistryEvalHistoryEntry;
  onPickSlug: (slug: string) => void;
}

function TimelineRow(props: RowProps) {
  const { entry, onPickSlug } = props;
  const isReg = entry.regressionStatus === "regression";
  const rowClass = isReg
    ? "py-1.5 px-1 hover:bg-rose-50/60 dark:hover:bg-rose-950/30"
    : "py-1.5 px-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/40";
  return (
    <li className={rowClass}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular-nums text-neutral-400">{fmtTimeShort(entry.createdAt)}</span>
          <button
            type="button"
            onClick={() => onPickSlug(entry.slug)}
            className="truncate font-mono text-[11px] text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-200"
            title={entry.slug}
          >
            {entry.slug}
          </button>
          <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {TRIGGER_LABEL[entry.triggerKind] ?? entry.triggerKind}
          </span>
          {isReg && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 text-[10px] text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
              回归
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 tabular-nums text-[10.5px]">
          <span className="text-neutral-500" title="score">
            S {fmtScore(entry.score)}
            {entry.scoreDelta !== null && (
              <span className={cn("ml-0.5", entry.scoreDelta < 0 ? "text-rose-600" : "text-emerald-600")}>
                {fmtDeltaScore(entry.scoreDelta)}
              </span>
            )}
          </span>
          <span className="text-neutral-500" title="activation">
            A {fmtPct(entry.activationRate)}
            {entry.activationDelta !== null && (
              <span className={cn("ml-0.5", entry.activationDelta < 0 ? "text-rose-600" : "text-emerald-600")}>
                {fmtDeltaPct(entry.activationDelta)}
              </span>
            )}
          </span>
        </div>
      </div>
      {isReg && entry.regressionReason && (
        <div className="mt-0.5 text-[10.5px] text-rose-600 dark:text-rose-300">{entry.regressionReason}</div>
      )}
    </li>
  );
}
