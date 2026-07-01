import { HeartPulse } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { HealthOverviewPane } from "@/components/HealthOverviewPane";
import { HealthDataPane } from "@/components/HealthDataPane";
import { HealthTargetPane } from "@/components/HealthTargetPane";
import { HealthDashboardPane } from "@/components/HealthDashboardPane";
import { HealthReportPane } from "@/components/HealthReportPane";
import { HealthReadmePane } from "@/components/HealthReadmePane";
import type { TabContext } from "./types";

export function HealthTabs({ ctx }: { ctx: TabContext }) {
  if (ctx.activeTab !== "health") return null;
  const ws = ctx.activeWorkspaceId;

  switch (ctx.activeSubTab) {
    case "health_overview":
      return <HealthOverviewPane workspaceId={ws} setActiveSubTab={ctx.setActiveSubTab} />;
    case "health_data":
      return <HealthDataPane workspaceId={ws} />;
    case "health_target":
      return <HealthTargetPane workspaceId={ws} setActiveSubTab={ctx.setActiveSubTab} />;
    case "health_dashboard":
      return <HealthDashboardPane workspaceId={ws} setActiveSubTab={ctx.setActiveSubTab} />;
    case "health_report":
      return <HealthReportPane workspaceId={ws} />;
    case "readme":
      return <HealthReadmePane />;
    default:
      return <Placeholder icon={HeartPulse} title="监测" hint="骨架占位" />;
  }
}
