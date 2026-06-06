import type { ChildProcess } from "node:child_process";

export type ChildProcessKind = "pi" | "tool" | "system";

export interface ChildProcessMeta {
  kind: ChildProcessKind;
  command: string;
  args: string[];
  cwd: string;
  label?: string;
  sessionId?: string;
  runId?: string;
}

export interface ChildProcessInfo extends ChildProcessMeta {
  id: string;
  pid: number | null;
  startedAt: number;
}

export type ChildProcessListener = (child: ChildProcess, info: ChildProcessInfo) => void;

const activeChildProcesses = new Map<string, ChildProcessInfo>();

export function registerChildProcess(child: ChildProcess, meta: ChildProcessMeta): ChildProcessInfo {
  const pid = child.pid ?? null;
  const info: ChildProcessInfo = {
    ...meta,
    id: `${meta.kind}:${pid ?? "pending"}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    pid,
    startedAt: Date.now(),
  };
  activeChildProcesses.set(info.id, info);
  const remove = () => {
    activeChildProcesses.delete(info.id);
  };
  child.once("close", remove);
  child.once("error", remove);
  return info;
}

export function notifyChildProcess(
  listener: ChildProcessListener | undefined,
  child: ChildProcess,
  meta: ChildProcessMeta,
): ChildProcessInfo {
  const info = registerChildProcess(child, meta);
  listener?.(child, info);
  return info;
}

export function listActiveChildProcesses(): ChildProcessInfo[] {
  return Array.from(activeChildProcesses.values()).sort((a, b) => a.startedAt - b.startedAt);
}
