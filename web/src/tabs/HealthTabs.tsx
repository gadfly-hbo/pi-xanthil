import { HeartPulse } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { HealthDataPane } from "@/components/HealthDataPane";
import { HealthDashboardPane } from "@/components/HealthDashboardPane";
import { HealthReportPane } from "@/components/HealthReportPane";
import { HealthTrendPane } from "@/components/HealthTrendPane";
import type { TabContext } from "./types";

export function HealthTabs({ ctx }: { ctx: TabContext }) {
  if (ctx.activeTab !== "health") return null;
  const ws = ctx.activeWorkspaceId;

  switch (ctx.activeSubTab) {
    case "health_data":
      return <HealthDataPane workspaceId={ws} />;
    case "health_dashboard":
      return <HealthDashboardPane workspaceId={ws} setActiveSubTab={ctx.setActiveSubTab} />;
    case "health_report":
      return <HealthReportPane workspaceId={ws} />;
    case "health_trend":
      return <HealthTrendPane workspaceId={ws} />;
    case "readme":
      return <Placeholder icon={HeartPulse} title="体检 · 说明" hint="确定性规则巡检（零 LLM），发现已发生的问题与将发生的风险" />;
    default:
      return <Placeholder icon={HeartPulse} title="体检" hint="骨架占位" />;
  }
}
