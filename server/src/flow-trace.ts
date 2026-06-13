import { getFlow, addTraceEvent } from "./db.ts";

/**
 * flow / flow_run 维度的 trace 事件写入（接缝层 · T-C2b）。
 *
 * 从 index.ts 上移，供 index.ts 的 WS abort 派发与 routes/engine.ts 的流式 handler 共享。
 * 带 runId 时归到 flow_run，否则归到 flow。
 */
export function traceFlowEvent(
  flowId: string,
  type: string,
  status: string,
  detail?: string | null,
  payload?: unknown,
  runId?: string,
): void {
  const flow = getFlow(flowId);
  if (!flow) return;
  addTraceEvent({
    workspaceId: flow.workspaceId,
    targetKind: runId ? "flow_run" : "flow",
    targetId: runId ?? flow.id,
    type,
    target: flow.name,
    status,
    detail,
    payload,
  });
}
