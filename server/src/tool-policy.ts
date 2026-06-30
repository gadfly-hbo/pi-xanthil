import type { ExtractionToolManifest } from "../tools/registry.ts";

export function isAiExposedTool(tool: Pick<ExtractionToolManifest, "category">): boolean {
  return tool.category === "analysis";
}

export function isToolBindable(tool: Pick<ExtractionToolManifest, "category">): boolean {
  return isAiExposedTool(tool);
}

export function listAiExposedToolIds(tools: Array<Pick<ExtractionToolManifest, "id" | "category">>): Set<string> {
  return new Set(tools.filter(isAiExposedTool).map((tool) => tool.id));
}

export function filterAiExposedTools<T extends Pick<ExtractionToolManifest, "category">>(tools: T[]): T[] {
  return tools.filter(isAiExposedTool);
}

export function renderToolManifestSummary(tool: Pick<ExtractionToolManifest, "tags" | "allowedUse" | "forbiddenUse" | "riskLevel">): string {
  const parts: string[] = [];
  if (tool.tags?.length) parts.push(`tags=${tool.tags.slice(0, 6).join(",")}`);
  if (tool.riskLevel) parts.push(`risk=${tool.riskLevel}`);
  if (tool.allowedUse) parts.push(`适用: ${tool.allowedUse}`);
  if (tool.forbiddenUse) parts.push(`禁止: ${tool.forbiddenUse}`);
  return parts.join("；");
}
