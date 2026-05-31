import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { PI_BIN } from "./config.ts";
import type { PiEvent } from "./types.ts";

export interface RunPiOptions {
  workspaceRoot: string;
  piSessionId: string; // we reuse our session id as pi's --session-id
  text: string;
  model?: string;
  systemPrompt?: string;
  onEvent: (event: PiEvent) => void;
}

export interface PiRun {
  done: Promise<number | null>;
  kill: () => void;
}

/**
 * Run one pi turn non-interactively in JSON mode. pi persists the conversation
 * under `--session-dir` keyed by `--session-id`, so each call resumes the same
 * session — the server itself stays stateless across turns.
 */
export function runPiTurn(opts: RunPiOptions): PiRun {
  const sessionDir = join(opts.workspaceRoot, ".pi-sessions");
  const args = [
    "-p",
    "--mode",
    "json",
    "--session-id",
    opts.piSessionId,
    "--session-dir",
    sessionDir,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  args.push(opts.text);

  const child = spawn(PI_BIN, args, {
    cwd: opts.workspaceRoot,
    env: process.env,
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

  return { done, kill: () => child.kill() };
}
