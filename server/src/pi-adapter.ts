import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN, HOOK_RUNNER_EXTENSION, HOOKS_CONFIG_PATH, HOOKS_LOG_PATH } from "./config.ts";
import type { PiEvent } from "./types.ts";
import { assembleSystemPrompt } from "./prompt-blocks.ts";
import { notifyChildProcess, registerChildProcess, type ChildProcessListener } from "./child-processes.ts";

export interface RunPiOptions {
  workspaceRoot: string;
  piSessionId: string; // we reuse our session id as pi's --session-id
  text: string;
  model?: string;
  systemPrompt?: string;
  skillPaths?: string[];
  forkFrom?: string; // 若设，则首轮用 `--fork <id>` 把该 session 历史播种进 piSessionId（Fork 分支用）
  onEvent: (event: PiEvent) => void;
  onChildProcess?: ChildProcessListener;
}

export interface PiRun {
  done: Promise<number | null>;
  kill: () => void;
  isRunning: () => boolean;
}

export interface RunPiPromptOptions {
  workspaceRoot: string;
  text: string;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
  onEvent?: (event: PiEvent) => void;
  onChildProcess?: ChildProcessListener;
}

interface PiRpcResponse<T> {
  type: "response";
  command: string;
  success: boolean;
  data?: T;
  error?: string;
}

export interface PiSessionStats {
  sessionFile: string;
  sessionId: string;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

function sessionDir(workspaceRoot: string): string {
  const dir = join(workspaceRoot, ".pi-sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Execute one RPC control command against a persisted session. The normal turn
 * runner stays in JSON mode; RPC is used only while idle for stats and compact.
 */
function runPiRpcCommand<T>(
  workspaceRoot: string,
  piSessionId: string,
  command: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const requestId = `xanthil-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const child = spawn(PI_BIN, [
      "--mode",
      "rpc",
      "--session-id",
      piSessionId,
      "--session-dir",
      sessionDir(workspaceRoot),
    ], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    registerChildProcess(child, {
      kind: "pi",
      command: PI_BIN,
      args: ["--mode", "rpc", "--session-id", piSessionId, "--session-dir", sessionDir(workspaceRoot)],
      cwd: workspaceRoot,
      label: "pi-rpc",
      sessionId: piSessionId,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, data?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(data as T);
    };
    const timer = setTimeout(() => finish(new Error(`pi RPC timed out after ${timeoutMs} ms`)), timeoutMs);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      while (true) {
        const newline = stdout.indexOf("\n");
        if (newline < 0) break;
        const line = stdout.slice(0, newline).replace(/\r$/, "");
        stdout = stdout.slice(newline + 1);
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof value !== "object" || value === null) continue;
        const response = value as Partial<PiRpcResponse<T>> & { id?: unknown };
        if (response.type !== "response" || response.id !== requestId) continue;
        if (!response.success) {
          finish(new Error(response.error || `pi RPC ${String(response.command)} failed`));
          return;
        }
        finish(undefined, response.data as T);
        return;
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(`pi RPC exited with code ${String(code)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
    // Keep stdin open until the response arrives. RPC mode treats EOF as a
    // shutdown request; closing immediately aborts long-running compact calls.
    child.stdin.write(`${JSON.stringify({ id: requestId, ...command })}\n`);
  });
}

export function getPiSessionStats(workspaceRoot: string, piSessionId: string): Promise<PiSessionStats> {
  return runPiRpcCommand<PiSessionStats>(workspaceRoot, piSessionId, { type: "get_session_stats" }, 15_000);
}

export function compactPiSession(workspaceRoot: string, piSessionId: string): Promise<unknown> {
  return runPiRpcCommand(workspaceRoot, piSessionId, {
    type: "compact",
    customInstructions: "保留用户目标、聚合数据范围、输出目录、关键结论、待办事项和已生成产物路径。",
  }, 120_000);
}

/**
 * Run one pi turn non-interactively in JSON mode. pi persists the conversation
 * under `--session-dir` keyed by `--session-id`, so each call resumes the same
 * session — the server itself stays stateless across turns.
 */
export function runPiPrompt(opts: RunPiPromptOptions): Promise<string> {
  const piSessionDir = sessionDir(opts.workspaceRoot);
  // One-shot, tool-free text completion. Pass the content inline; the model never needs to call
  // tools or read project files here. We disable tools + context-file discovery so we don't pay
  // pi's full agent context (~28k tokens of tool schemas / extension prompts) on every call — that
  // overhead, combined with thinking models, is the dominant cause of "pi prompt timed out".
  // NOTE: keep extensions enabled — `--no-extensions` would also disable the model provider extension.
  const args = ["-p", "--mode", "json", "--no-skills", "--no-tools", "--no-context-files", "--session-id", `toc-${Date.now()}-${Math.random().toString(36).slice(2)}`, "--session-dir", piSessionDir];
  if (opts.model) args.push("--model", opts.model);
  args.push("--system-prompt", assembleSystemPrompt(opts.systemPrompt));
  args.push(opts.text);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(PI_BIN, args, {
      cwd: opts.workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    notifyChildProcess(opts.onChildProcess, child, {
      kind: "pi",
      command: PI_BIN,
      args: args.slice(0, -1),
      cwd: opts.workspaceRoot,
      label: "pi-prompt",
    });
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`pi prompt timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    let stderr = "";
    let output = "";
    const allEvents: string[] = [];
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      allEvents.push(trimmed);
      try {
        const event = JSON.parse(trimmed) as PiEvent;
        opts.onEvent?.(event);
        if (event.type === "message_end" || event.type === "turn_end") {
          const { message } = event as Extract<PiEvent, { type: "message_end" | "turn_end" }>;
          if (message.role === "assistant") output = extractPiMessageText(message.content) || output;
        }
      } catch {
        // Ignore non-JSON process noise.
      }
    });
    let exitCode: number | null = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (exitCode !== 0 && exitCode !== null) {
        reject(new Error(`pi exited with code ${String(exitCode)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      } else {
        const result = output.trim();
        if (!result) {
          resolve(`DEBUG_EMPTY_OUTPUT: ${allEvents.join("\n")}`);
        } else {
          resolve(result);
        }
      }
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      exitCode = code;
      // Wait for rl close to ensure stdout is fully drained
    });
    rl.on("close", () => {
      finish();
    });
  });
}

function extractPiMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function runPiTurn(opts: RunPiOptions): PiRun {
  const piSessionDir = sessionDir(opts.workspaceRoot);
  const args = [
    "-p",
    "--mode",
    "json",
    "--session-id",
    opts.piSessionId,
    "--session-dir",
    piSessionDir,
  ];
  // Fork 分支首轮：从父 session 历史播种进新分支 session。
  if (opts.forkFrom) args.push("--fork", opts.forkFrom);
  if (opts.model) args.push("--model", opts.model);
  args.push("--system-prompt", assembleSystemPrompt(opts.systemPrompt));
  if (opts.skillPaths) {
    args.push("--no-skills");
    for (const path of opts.skillPaths) args.push("--skill", path);
  }
  // 计算工具·hooks 管理：注入 px-hook-runner 扩展（仅 pi-xanthil 触发的 pi 加载，用户手动 pi 不受影响）。
  // 扩展运行时读 PX_HOOKS_CONFIG(hooks.json)、把触发流水写 PX_HOOKS_LOG(hooks-triggers.jsonl)。
  const hookEnv: Record<string, string> = {};
  if (existsSync(HOOK_RUNNER_EXTENSION)) {
    args.push("-e", HOOK_RUNNER_EXTENSION);
    hookEnv.PX_HOOKS_CONFIG = HOOKS_CONFIG_PATH;
    hookEnv.PX_HOOKS_LOG = HOOKS_LOG_PATH;
  }
  args.push(opts.text);

  opts.onEvent({ type: "process_start", cwd: opts.workspaceRoot, command: PI_BIN, args: args.slice(0, -1), sessionDir: piSessionDir });

  const child = spawn(PI_BIN, args, {
    cwd: opts.workspaceRoot,
    env: { ...process.env, ...hookEnv },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  notifyChildProcess(opts.onChildProcess, child, {
    kind: "pi",
    command: PI_BIN,
    args: args.slice(0, -1),
    cwd: opts.workspaceRoot,
    label: "pi-turn",
    sessionId: opts.piSessionId,
  });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      opts.onEvent(JSON.parse(trimmed) as PiEvent);
    } catch {
      // Non-JSON lines (e.g. extension load errors on stderr-merged output) are ignored.
    }
  });

  // stderr is surfaced as a synthetic event so the UI can show pi-side noise.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    opts.onEvent({ type: "stderr", text: chunk });
  });

  const done = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      rl.close();
      resolve(code);
    });
    child.on("error", (err) => {
      opts.onEvent({ type: "spawn_error", message: String(err) });
      resolve(null);
    });
  });

  return {
    done,
    kill: () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // Fall back to the direct child if the process group already exited.
        }
      }
      child.kill();
    },
    isRunning: () => child.exitCode === null && child.signalCode === null,
  };
}
