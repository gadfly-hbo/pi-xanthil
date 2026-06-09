import { json } from "./_http";

export interface Dashboard {
  id: string;
  workspace_id: string;
  name: string;
  layout_json: string;
  created_at: number;
  updated_at: number;
}

export const vizApi = {
  listDashboards: (workspaceId: string) =>
    fetch(`/api/dashboards?workspaceId=${encodeURIComponent(workspaceId)}`).then(json<Dashboard[]>),
  createDashboard: (data: { workspaceId: string; name: string; layoutJson: string }) =>
    fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json<Dashboard>),
  updateDashboard: (id: string, data: { name?: string; layoutJson?: string }) =>
    fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json<Dashboard>),
  deleteDashboard: (id: string) =>
    fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(json<{ success: boolean }>),
};

