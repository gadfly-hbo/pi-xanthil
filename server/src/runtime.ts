import type { WebSocket } from "ws";
import type { PiRun } from "./pi-adapter.ts";
import type { ServerMessage } from "./types.ts";

/**
 * 横切运行时状态（接缝层 · 总控持有）。
 *
 * 集中存放 WebSocket gateway 的活跃运行态与发送助手，供 index.ts bootstrap
 * 与（迁出后的）domain 路由共享。`wss` 本身依赖 `app.listen()` 的 http server，
 * 且仅 index.ts bootstrap 使用（创建 + on("connection") 派发），故留在 index.ts，
 * 不在此处持有。
 *
 * 见 docs/工作流改造-任务派发.md T-C1。
 */

/** 安全发送：仅在连接 OPEN 时序列化下发，避免对已关闭连接写入抛错。 */
export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export interface ActiveChatRun {
  run: PiRun;
  aborted: boolean;
  startedAt: number;
}

export interface ActiveMultiAgentRun {
  // A Set (not a single ref) so fan-out nodes — which launch several concurrent
  // pi turns under one node — can all be killed on abort.
  currentRuns: Set<PiRun>;
  aborted: boolean;
  dbRunId: string;
  flowId: string;
  ws: WebSocket;
}

export const activeSessionRuns = new Map<string, ActiveChatRun>();
export const activeSessionControls = new Set<string>();
export const activeFlowRuns = new Map<string, ActiveChatRun>();
export const activeMultiAgentRuns = new Map<string, ActiveMultiAgentRun>();

/** 返回仍在运行的活跃 chat run；已结束的顺手从 map 清除。session/flow 共用。 */
export function getActiveChatRun(runs: Map<string, ActiveChatRun>, id: string): ActiveChatRun | undefined {
  const active = runs.get(id);
  if (!active) return undefined;
  if (active.run.isRunning()) return active;
  runs.delete(id);
  return undefined;
}

/** 中止活跃 chat run（标记 aborted + kill 进程）。返回是否确有运行被中止。 */
export function abortChatRun(runs: Map<string, ActiveChatRun>, id: string): boolean {
  const active = getActiveChatRun(runs, id);
  if (!active) return false;
  runs.delete(id);
  active.aborted = true;
  active.run.kill();
  return true;
}
