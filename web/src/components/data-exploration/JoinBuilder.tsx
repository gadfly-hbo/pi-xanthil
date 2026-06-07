// LLM_FORBIDDEN: this module must never call any LLM API.
// Cross-table JOIN builder. Materializes the join into a real duckdb table via
// lib/joins; all SQL runs in-browser, no data leaves the machine.

import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, Wand2, X } from "lucide-react";
import { materializeJoin, detectJoinCandidates, type JoinStep, type JoinType, type JoinCandidate } from "@/lib/joins";
import type { FieldSchema } from "@/lib/profiling";

interface TableMeta {
  tableName: string;
  label: string;
  fields: FieldSchema[];
}

interface Props {
  tables: TableMeta[];
  onJoined: (tableName: string, label: string) => Promise<void>;
}

interface StepDraft {
  leftTable: string;
  leftColumn: string;
  table: string; // right table
  rightColumn: string;
  type: JoinType;
}

export function JoinBuilder({ tables, onJoined }: Props) {
  const [baseTable, setBaseTable] = useState(tables[0]?.tableName ?? "");
  const [steps, setSteps] = useState<StepDraft[]>([
    {
      leftTable: tables[0]?.tableName ?? "",
      leftColumn: "",
      table: tables[1]?.tableName ?? "",
      rightColumn: "",
      type: "inner",
    },
  ]);
  const [applying, setApplying] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [candidates, setCandidates] = useState<JoinCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labelOf = useCallback(
    (tableName: string) => tables.find((t) => t.tableName === tableName)?.label ?? tableName,
    [tables],
  );
  const columnsOf = useCallback(
    (tableName: string) => tables.find((t) => t.tableName === tableName)?.fields.map((f) => f.name) ?? [],
    [tables],
  );

  // Tables already present in the chain before step i (valid as its left table).
  const leftOptionsAt = useCallback(
    (i: number) => [baseTable, ...steps.slice(0, i).map((s) => s.table)].filter(Boolean),
    [baseTable, steps],
  );

  const tableColumns = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const t of tables) map[t.tableName] = t.fields.map((f) => f.name);
    return map;
  }, [tables]);

  const updateStep = (i: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { leftTable: baseTable, leftColumn: "", table: "", rightColumn: "", type: "inner" },
    ]);
  };

  const removeStep = (i: number) => {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  };

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      const found = await detectJoinCandidates(tables.map((t) => ({ tableName: t.tableName, fields: t.fields })));
      setCandidates(found);
    } catch (err) {
      setError(String(err));
    } finally {
      setDetecting(false);
    }
  }, [tables]);

  const applyCandidate = (c: JoinCandidate) => {
    setBaseTable(c.leftTable);
    setSteps([
      { leftTable: c.leftTable, leftColumn: c.leftColumn, table: c.rightTable, rightColumn: c.rightColumn, type: "inner" },
    ]);
  };

  const canApply =
    baseTable &&
    steps.every((s) => s.leftTable && s.leftColumn && s.table && s.rightColumn);

  const handleApply = useCallback(async () => {
    if (!canApply) return;
    setApplying(true);
    setError(null);
    try {
      const joinSteps: JoinStep[] = steps.map((s) => ({
        leftTable: s.leftTable,
        leftColumn: s.leftColumn,
        table: s.table,
        rightColumn: s.rightColumn,
        type: s.type,
      }));
      const newName = await materializeJoin(baseTable, joinSteps, tableColumns);
      const label = [baseTable, ...steps.map((s) => s.table)].map(labelOf).join(" ⋈ ");
      await onJoined(newName, label);
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(false);
    }
  }, [canApply, steps, baseTable, tableColumns, labelOf, onJoined]);

  const selectCls =
    "rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-700 outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200";

  return (
    <div className="border-b border-indigo-200 bg-indigo-50/50 px-3 py-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-indigo-700 dark:text-indigo-300">跨表关联 (JOIN)</span>
        <button
          onClick={() => void handleDetect()}
          disabled={detecting}
          className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-0.5 text-[11px] text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:bg-neutral-900 dark:text-indigo-300"
        >
          {detecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" strokeWidth={1.75} />}
          检测关联候选
        </button>
      </div>

      {candidates && (
        <div className="mb-2 rounded border border-indigo-200 bg-white p-1.5 text-[11px] dark:border-indigo-900/60 dark:bg-neutral-900">
          {candidates.length === 0 ? (
            <span className="text-neutral-500">未发现明显的关联候选（去重值重叠率 ≥ 30%）。</span>
          ) : (
            <div className="flex flex-col gap-1">
              {candidates.slice(0, 8).map((c, i) => (
                <button
                  key={i}
                  onClick={() => applyCandidate(c)}
                  className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-neutral-800"
                >
                  <span className="truncate text-neutral-700 dark:text-neutral-300">
                    {labelOf(c.leftTable)}.<b>{c.leftColumn}</b> ↔ {labelOf(c.rightTable)}.<b>{c.rightColumn}</b>
                  </span>
                  <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">{(c.overlap * 100).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-neutral-500">主表</span>
        <select value={baseTable} onChange={(e) => setBaseTable(e.target.value)} className={selectCls}>
          {tables.map((t) => (
            <option key={t.tableName} value={t.tableName}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <select value={s.type} onChange={(e) => updateStep(i, { type: e.target.value as JoinType })} className={selectCls}>
              <option value="inner">INNER</option>
              <option value="left">LEFT</option>
            </select>
            <span className="text-neutral-500">左</span>
            <select value={s.leftTable} onChange={(e) => updateStep(i, { leftTable: e.target.value, leftColumn: "" })} className={selectCls}>
              <option value="">表…</option>
              {leftOptionsAt(i).map((tn) => (
                <option key={tn} value={tn}>{labelOf(tn)}</option>
              ))}
            </select>
            <select value={s.leftColumn} onChange={(e) => updateStep(i, { leftColumn: e.target.value })} className={selectCls} disabled={!s.leftTable}>
              <option value="">列…</option>
              {columnsOf(s.leftTable).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="text-neutral-400">=</span>
            <span className="text-neutral-500">右</span>
            <select value={s.table} onChange={(e) => updateStep(i, { table: e.target.value, rightColumn: "" })} className={selectCls}>
              <option value="">表…</option>
              {tables.map((t) => (
                <option key={t.tableName} value={t.tableName}>{t.label}</option>
              ))}
            </select>
            <select value={s.rightColumn} onChange={(e) => updateStep(i, { rightColumn: e.target.value })} className={selectCls} disabled={!s.table}>
              <option value="">列…</option>
              {columnsOf(s.table).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {steps.length > 1 && (
              <button onClick={() => removeStep(i)} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700" title="删除该关联">
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button onClick={addStep} className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          <Plus className="h-3 w-3" strokeWidth={2} />
          添加关联
        </button>
        <button
          onClick={() => void handleApply()}
          disabled={!canApply || applying}
          className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          应用关联（生成新表）
        </button>
        {error && <span className="truncate text-[11px] text-red-500" title={error}>{error}</span>}
      </div>
    </div>
  );
}
