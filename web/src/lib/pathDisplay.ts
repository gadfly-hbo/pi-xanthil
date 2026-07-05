const MANAGED_WORKSPACE_RE = /^.*[\\/]\.pi-xanthil[\\/]workspaces[\\/][^\\/]+[\\/]?/;

export function formatDisplayPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return path;
  const stripped = trimmed.replace(MANAGED_WORKSPACE_RE, "");
  return stripped || trimmed;
}
