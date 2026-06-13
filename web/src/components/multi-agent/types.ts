import type { PiEvent, WorkflowDef, WorkflowNode } from "@/types";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepState {
  status: StepStatus;
  output: string;
  events: PiEvent[];
}

export interface ToolStepOutput {
  kind: "tool";
  toolId: string;
  outputPath: string;
  summaryPath: string;
  success: boolean;
  artifacts: string[];
}

export type CenterTab = "flow" | "logs";

export type WorkflowNodeKind = NonNullable<WorkflowNode["kind"]>;

export interface GateOnBlock {
  retryFromNodeId: string;
  maxIterations?: number;
  feedbackVar?: string;
}

export type EditableWorkflowNode = WorkflowNode & { onBlock?: GateOnBlock };
export type EditableWorkflowDef = Omit<WorkflowDef, "nodes"> & { nodes: EditableWorkflowNode[] };

export type WorkflowIssueLevel = "warning" | "error";

export interface WorkflowIssue {
  level: WorkflowIssueLevel;
  nodeId?: string;
  edgeId?: string;
  message: string;
}
