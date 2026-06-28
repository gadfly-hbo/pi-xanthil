import { useState, useCallback, useMemo } from "react";
import { Save, RotateCcw, Pencil, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  CrowdDataset,
  CrowdTagDictionaryEntry,
  CrowdProfileDimension,
  CrowdTagSensitivity,
} from "@/types";

interface Props {
  workspaceId: string;
  dataset: CrowdDataset;
  entries: CrowdTagDictionaryEntry[];
  onSaved: (entries: CrowdTagDictionaryEntry[]) => void;
}

const DIMENSIONS: { value: CrowdProfileDimension; label: string }[] = [
  { value: "demographic", label: "人口属性" },
  { value: "consumption_power", label: "消费能力" },
  { value: "interest_preference", label: "兴趣偏好" },
  { value: "channel_preference", label: "渠道偏好" },
  { value: "price_sensitivity", label: "价格敏感" },
  { value: "lifecycle", label: "生命周期" },
  { value: "scenario_preference", label: "场景偏好" },
  { value: "custom", label: "自定义" },
];

const SENSITIVITIES: { value: CrowdTagSensitivity; label: string }[] = [
  { value: "public", label: "公开" },
  { value: "internal", label: "内部" },
  { value: "sensitive", label: "敏感" },
];

interface DraftEntry {
  field: string;
  label: string;
  description: string;
  dimension: CrowdProfileDimension;
  sensitivity: CrowdTagSensitivity;
  weight: number;
  valueLabels: Record<string, string>;
  enabled: boolean;
}

function entryToDraft(e: CrowdTagDictionaryEntry): DraftEntry {
  return {
    field: e.field,
    label: e.label,
    description: e.description,
    dimension: e.dimension,
    sensitivity: e.sensitivity,
    weight: e.weight,
    valueLabels: { ...e.valueLabels },
    enabled: e.enabled,
  };
}

function draftToEntryInput(d: DraftEntry) {
  return {
    field: d.field,
    label: d.label,
    description: d.description,
    dimension: d.dimension,
    sensitivity: d.sensitivity,
    weight: d.weight,
    valueLabels: d.valueLabels,
    enabled: d.enabled,
  };
}

export function TagDictionaryEditor({ workspaceId, dataset, entries, onSaved }: Props) {
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => {
    const existingMap = new Map(entries.map((e) => [e.field, e]));
    return dataset.fieldProfiles.map((fp) => {
      const existing = existingMap.get(fp.field);
      return existing
        ? entryToDraft(existing)
        : {
            field: fp.field,
            label: fp.field,
            description: "",
            dimension: "custom" as CrowdProfileDimension,
            sensitivity: "internal" as CrowdTagSensitivity,
            weight: 1,
            valueLabels: {} as Record<string, string>,
            enabled: true,
          };
    });
  });
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    const existingMap = new Map(entries.map((e) => [e.field, e]));
    if (drafts.length !== dataset.fieldProfiles.length) return true;
    for (const d of drafts) {
      const e = existingMap.get(d.field);
      if (!e) return true;
      if (d.label !== e.label || d.description !== e.description || d.dimension !== e.dimension ||
          d.sensitivity !== e.sensitivity || d.weight !== e.weight || d.enabled !== e.enabled ||
          JSON.stringify(d.valueLabels) !== JSON.stringify(e.valueLabels)) return true;
    }
    return false;
  }, [drafts, entries, dataset.fieldProfiles.length]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveCrowdTagDictionary(workspaceId, dataset.id, drafts.map(draftToEntryInput));
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [workspaceId, dataset.id, drafts, onSaved]);

  const handleReset = useCallback(() => {
    const existingMap = new Map(entries.map((e) => [e.field, e]));
    setDrafts(dataset.fieldProfiles.map((fp) => {
      const existing = existingMap.get(fp.field);
      return existing ? entryToDraft(existing) : {
        field: fp.field, label: fp.field, description: "", dimension: "custom" as CrowdProfileDimension,
        sensitivity: "internal" as CrowdTagSensitivity, weight: 1, valueLabels: {} as Record<string, string>, enabled: true,
      };
    }));
  }, [dataset.fieldProfiles, entries]);

  const updateDraft = useCallback((field: string, patch: Partial<DraftEntry>) => {
    setDrafts((prev) => prev.map((d) => (d.field === field ? { ...d, ...patch } : d)));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">标签字典</h3>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button onClick={handleReset} className="flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted transition-colors">
              <RotateCcw className="h-3 w-3" /> 重置
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Save className="h-3 w-3" /> {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">字段</th>
              <th className="px-3 py-2 text-left font-medium">类型</th>
              <th className="px-3 py-2 text-left font-medium">业务名</th>
              <th className="px-3 py-2 text-left font-medium">维度</th>
              <th className="px-3 py-2 text-left font-medium">敏感级</th>
              <th className="px-3 py-2 text-left font-medium">权重</th>
              <th className="px-3 py-2 text-left font-medium">启用</th>
              <th className="px-3 py-2 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const fp = dataset.fieldProfiles.find((p) => p.field === d.field);
              const isEditing = editingField === d.field;
              return (
                <tr key={d.field} className={cn("border-b hover:bg-muted/30", !d.enabled && "opacity-50")}>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{d.field}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{fp?.inferredType ?? "unknown"}</td>
                  <td className="px-3 py-1.5">
                    {isEditing ? (
                      <input
                        className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs"
                        value={d.label}
                        onChange={(e) => updateDraft(d.field, { label: e.target.value })}
                      />
                    ) : (
                      <span>{d.label}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                      value={d.dimension}
                      onChange={(e) => updateDraft(d.field, { dimension: e.target.value as CrowdProfileDimension })}
                    >
                      {DIMENSIONS.map((dim) => (
                        <option key={dim.value} value={dim.value}>{dim.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                      value={d.sensitivity}
                      onChange={(e) => updateDraft(d.field, { sensitivity: e.target.value as CrowdTagSensitivity })}
                    >
                      {SENSITIVITIES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-14 rounded border border-input bg-background px-1 py-0.5 text-xs text-right"
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={d.weight}
                      onChange={(e) => updateDraft(d.field, { weight: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => updateDraft(d.field, { enabled: e.target.checked })}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => setEditingField(isEditing ? null : d.field)}
                      className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isEditing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
