import { useCallback, useMemo, useState } from "react";
import { Plus, Trash2, RefreshCw, Copy, Save, X, AlertTriangle, Users, Percent } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type {
  CrowdFieldProfile,
  CrowdSegmentRuleGroup,
  CrowdSegmentRuleCondition,
  CrowdSegmentRuleOperator,
  CrowdSegmentRuleLogic,
  CrowdSegment,
  CrowdTagValueSummary,
} from "@/types";

interface Props {
  workspaceId: string;
  datasetId: string;
  fieldProfiles: CrowdFieldProfile[];
  rowCount: number;
  existingSegment?: CrowdSegment;
  onSave?: (segment: CrowdSegment) => void;
  onCancel?: () => void;
}

const OPERATORS: { value: CrowdSegmentRuleOperator; label: string }[] = [
  { value: "eq", label: "等于" },
  { value: "neq", label: "不等于" },
  { value: "in", label: "包含于" },
  { value: "not_in", label: "不包含于" },
  { value: "range", label: "区间" },
  { value: "exists", label: "有值" },
  { value: "missing", label: "缺失" },
];

function emptyCondition(field?: string): CrowdSegmentRuleCondition {
  return { field: field ?? "", operator: "eq" };
}

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function SegmentBuilder({ workspaceId, datasetId, fieldProfiles, rowCount, existingSegment, onSave, onCancel }: Props) {
  const [logic, setLogic] = useState<CrowdSegmentRuleLogic>(existingSegment?.rule.logic ?? "and");
  const [conditions, setConditions] = useState<CrowdSegmentRuleCondition[]>(
    existingSegment?.rule.conditions.length
      ? existingSegment.rule.conditions
      : [emptyCondition()],
  );
  const [name, setName] = useState(existingSegment?.name ?? "");
  const [description, setDescription] = useState(existingSegment?.description ?? "");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{
    sampleCount: number;
    coverageRatio: number;
    tagDistribution: Record<string, CrowdTagValueSummary[]>;
    errors: Array<{ field: string; message: string }>;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const rule: CrowdSegmentRuleGroup = useMemo(() => ({ logic, conditions }), [logic, conditions]);

  const updateCondition = useCallback((idx: number, patch: Partial<CrowdSegmentRuleCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }, []);

  const removeCondition = useCallback((idx: number) => {
    setConditions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }, []);

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, emptyCondition()]);
  }, []);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await api.previewCrowdSegment(workspaceId, datasetId, rule);
      setPreview(result);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview failed");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [workspaceId, datasetId, rule]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (existingSegment) {
        const updated = await api.updateCrowdSegment(workspaceId, existingSegment.id, {
          name: name.trim(),
          description: description.trim(),
          rule,
        });
        onSave?.(updated);
      } else {
        const created = await api.createCrowdSegment(workspaceId, {
          datasetId,
          name: name.trim(),
          description: description.trim(),
          rule,
        });
        onSave?.(created);
      }
    } finally {
      setSaving(false);
    }
  }, [workspaceId, datasetId, name, description, rule, existingSegment, onSave]);

  const handleCopy = useCallback(async () => {
    if (!existingSegment) return;
    setSaving(true);
    try {
      const copied = await api.copyCrowdSegment(workspaceId, existingSegment.id);
      onSave?.(copied);
    } finally {
      setSaving(false);
    }
  }, [workspaceId, existingSegment, onSave]);

  const isDirty = useMemo(() => {
    if (!existingSegment) return true;
    return (
      name !== existingSegment.name ||
      description !== existingSegment.description ||
      logic !== existingSegment.rule.logic ||
      JSON.stringify(conditions) !== JSON.stringify(existingSegment.rule.conditions)
    );
  }, [existingSegment, name, description, logic, conditions]);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
          placeholder="分群名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {onCancel && (
          <button onClick={onCancel} className="rounded-md p-1.5 hover:bg-muted" title="取消">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <input
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
        placeholder="描述（可选）"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {/* logic toggle */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">条件逻辑：</span>
        <button
          onClick={() => setLogic("and")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium border transition-colors",
            logic === "and"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input hover:bg-muted",
          )}
        >
          全部满足 (AND)
        </button>
        <button
          onClick={() => setLogic("or")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium border transition-colors",
            logic === "or"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input hover:bg-muted",
          )}
        >
          任一满足 (OR)
        </button>
      </div>

      {/* conditions */}
      <div className="space-y-2">
        {conditions.map((cond, idx) => {
          const isRange = cond.operator === "range";
          const needsValue = ["eq", "neq", "in", "not_in"].includes(cond.operator);
          const noValue = ["exists", "missing"].includes(cond.operator);

          return (
            <div key={idx} className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
              {/* field select */}
              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-xs min-w-[120px]"
                value={cond.field}
                onChange={(e) => updateCondition(idx, { field: e.target.value })}
              >
                <option value="">选择字段</option>
                {fieldProfiles.map((fp) => (
                  <option key={fp.field} value={fp.field}>
                    {fp.field} ({fp.inferredType})
                  </option>
                ))}
              </select>

              {/* operator select */}
              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-xs min-w-[90px]"
                value={cond.operator}
                onChange={(e) => {
                  const op = e.target.value as CrowdSegmentRuleOperator;
                  const patch: Partial<CrowdSegmentRuleCondition> = { operator: op };
                  if (["exists", "missing"].includes(op)) {
                    patch.value = undefined;
                    patch.min = undefined;
                    patch.max = undefined;
                  }
                  if (op === "range") {
                    patch.value = undefined;
                  }
                  updateCondition(idx, patch);
                }}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>

              {/* value input */}
              {needsValue && (
                <input
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs min-w-[100px]"
                  placeholder={cond.operator === "in" || cond.operator === "not_in" ? "逗号分隔多个值" : "值"}
                  value={
                    Array.isArray(cond.value)
                      ? cond.value.join(",")
                      : cond.value != null
                        ? String(cond.value)
                        : ""
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (cond.operator === "in" || cond.operator === "not_in") {
                      updateCondition(idx, { value: raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined });
                    } else {
                      updateCondition(idx, { value: raw || undefined });
                    }
                  }}
                />
              )}

              {/* range inputs */}
              {isRange && (
                <div className="flex items-center gap-1 text-xs">
                  <input
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    placeholder="min"
                    type="number"
                    value={cond.min ?? ""}
                    onChange={(e) => updateCondition(idx, { min: e.target.value ? Number(e.target.value) : undefined })}
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    placeholder="max"
                    type="number"
                    value={cond.max ?? ""}
                    onChange={(e) => updateCondition(idx, { max: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>
              )}

              {noValue && <span className="text-xs text-muted-foreground self-center">无需输入值</span>}

              {/* weight */}
              <input
                className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs"
                placeholder="权重"
                type="number"
                min={0}
                max={10}
                value={cond.weight ?? ""}
                onChange={(e) => updateCondition(idx, { weight: e.target.value ? Number(e.target.value) : undefined })}
              />

              <button
                onClick={() => removeCondition(idx)}
                className="rounded-md p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title="删除条件"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={addCondition}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="h-3 w-3" /> 添加条件
      </button>

      {/* actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={runPreview}
          disabled={previewing || conditions.some((c) => !c.field)}
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn("h-3 w-3", previewing && "animate-spin")} />
          预览结果
        </button>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !isDirty}
          className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="h-3 w-3" />
          {existingSegment ? "更新分群" : "创建分群"}
        </button>

        {existingSegment && (
          <button
            onClick={handleCopy}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Copy className="h-3 w-3" />
            复制分群
          </button>
        )}
      </div>

      {/* preview result */}
      {previewError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{previewError}</span>
        </div>
      )}

      {preview && (
        <div className="rounded-md border bg-card p-3 space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">预估样本：</span>
              <span className="font-semibold">{formatCount(preview.sampleCount)}</span>
              <span className="text-xs text-muted-foreground">/ {formatCount(rowCount)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">覆盖率：</span>
              <span className="font-semibold">{(preview.coverageRatio * 100).toFixed(1)}%</span>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="space-y-1">
              {preview.errors.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="font-medium">{e.field}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}

          {Object.keys(preview.tagDistribution).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                核心标签分布（{Object.keys(preview.tagDistribution).length} 个字段）
              </summary>
              <div className="mt-2 space-y-2">
                {Object.entries(preview.tagDistribution).map(([field, values]) => (
                  <div key={field}>
                    <div className="font-medium text-foreground mb-1">{field}</div>
                    <div className="flex flex-wrap gap-1">
                      {values.slice(0, 5).map((v, i) => (
                        <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          {v.value}: {formatCount(v.count)} ({(v.ratio * 100).toFixed(0)}%)
                        </span>
                      ))}
                      {values.length > 5 && (
                        <span className="text-muted-foreground">+{values.length - 5} more</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
