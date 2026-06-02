import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN } from "./config.ts";
import type { PiEvent } from "./types.ts";
import { assembleSystemPrompt } from "./prompt-blocks.ts";

export interface RunPiOptions {
  workspaceRoot: string;
  piSessionId: string; // we reuse our session id as pi's --session-id
  text: string;
  model?: string;
  systemPrompt?: string;
  skillPaths?: string[];
  onEvent: (event: PiEvent) => void;
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
  const args = ["-p", "--mode", "json", "--session-id", `toc-${Date.now()}-${Math.random().toString(36).slice(2)}`, "--session-dir", piSessionDir];
  if (opts.model) args.push("--model", opts.model);
  args.push("--system-prompt", assembleSystemPrompt(opts.systemPrompt));
  args.push(opts.text);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(PI_BIN, args, {
      cwd: opts.workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`pi prompt timed out after ${opts.timeoutMs ?? 120_000} ms`));
    }, opts.timeoutMs ?? 120_000);
    let stderr = "";
    let output = "";
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as PiEvent;
        if (event.type === "message_end" || event.type === "turn_end") {
          const { message } = event as Extract<PiEvent, { type: "message_end" | "turn_end" }>;
          if (message.role === "assistant") output = extractPiMessageText(message.content) || output;
        }
      } catch {
        // Ignore non-JSON process noise.
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      rl.close();
      if (code !== 0) reject(new Error(`pi exited with code ${String(code)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      else resolve(output.trim());
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
  if (opts.model) args.push("--model", opts.model);
  args.push("--system-prompt", assembleSystemPrompt(opts.systemPrompt));
  if (opts.skillPaths) {
    args.push("--no-skills");
    for (const path of opts.skillPaths) args.push("--skill", path);
  }
  args.push(opts.text);

  opts.onEvent({ type: "process_start", cwd: opts.workspaceRoot, command: PI_BIN, args: args.slice(0, -1), sessionDir: piSessionDir });

  const child = spawn(PI_BIN, args, {
    cwd: opts.workspaceRoot,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
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
