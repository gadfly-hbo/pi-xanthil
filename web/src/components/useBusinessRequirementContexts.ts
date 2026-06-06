import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { WorkspacePath } from "@/types";

export type BusinessRequirementContextScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

export interface BusinessRequirementContextOption {
  id: string;
  pathId: number;
  markdownPath: string;
  jsonPath: string;
  label: string;
  jsonStale: boolean;
}

export function useBusinessRequirementContexts(scope: BusinessRequirementContextScope | null) {
  const [contexts, setContexts] = useState<BusinessRequirementContextOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContexts([]);
    setSelectedId("");
    if (!scope) return;
    setLoading(true);
    const listPaths = scope.type === "workspace"
      ? api.listWorkspacePaths(scope.workspaceId, "report")
      : scope.type === "session"
        ? api.listSessionPaths(scope.sessionId, "report")
        : api.listFlowPaths(scope.flowId, "report");
    listPaths
      .then(async (paths: WorkspacePath[]) => {
        const reportPaths = paths.filter((path) => path.status !== "missing");
        const groups = await Promise.all(reportPaths.map(async (path) => {
          try {
            const result = await api.listBusinessRequirementVersions(path.id);
            return result.versions.map((version): BusinessRequirementContextOption => ({
              id: `${path.id}:${version.id}`,
              pathId: path.id,
              markdownPath: version.markdownPath,
              jsonPath: version.jsonPath,
              label: `${version.projectName} · ${new Date(version.generatedAt).toLocaleString()}${version.jsonStale ? " · 已编辑" : ""}`,
              jsonStale: version.jsonStale,
            }));
          } catch {
            return [];
          }
        }));
        if (cancelled) return;
        const next = groups.flat();
        setContexts(next);
        setSelectedId((current) => next.some((item) => item.id === current) ? current : "");
      })
      .catch(() => {
        if (!cancelled) setContexts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const selectedContext = useMemo(
    () => contexts.find((item) => item.id === selectedId) ?? null,
    [contexts, selectedId],
  );

  return { contexts, selectedId, setSelectedId, selectedContext, loading };
}
