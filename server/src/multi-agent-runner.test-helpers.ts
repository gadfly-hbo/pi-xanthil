// Test helpers for multi-agent-runner: a deterministic fake pi-turn launcher.
//
// The fake never spawns a child process. It synchronously schedules a
// scripted sequence of PiEvents on the next microtask, then resolves the
// PiRun.done promise with the configured exit code. This lets us exercise
// the full runMultiAgent() control flow — topo order, blackboard wiring,
// gate handling, abort, error propagation — without touching the real
// pi binary or the filesystem-bound .pi-sessions directory.

import type { PiRun, RunPiOptions } from "./pi-adapter.ts";
import type { PiEvent } from "./types.ts";
import type { PiTurnFn } from "./multi-agent-runner.ts";

export interface ScriptedNodeResponse {
  /** Final assistant text injected via a synthetic `message_end` event. */
  text?: string;
  /** Extra events emitted *before* the synthesized message_end (raw passthrough). */
  events?: PiEvent[];
  /** Exit code to resolve `PiRun.done` with. Defaults to 0. */
  exitCode?: number | null;
  /**
   * If set, the fake stalls forever (done never resolves on its own) until
   * `kill()` is called, which then resolves with `null`. Used to test abort.
   */
  stall?: boolean;
  /**
   * Optional dynamic builder that can inspect the actual `RunPiOptions`
   * (prompt text, workspaceRoot, etc.) and produce text/events on the fly.
   * Takes precedence over the static `text` / `events` fields.
   */
  build?: (opts: RunPiOptions) => { text?: string; events?: PiEvent[]; exitCode?: number | null };
}

export interface FakePiAdapter {
  runTurn: PiTurnFn;
  /** Every RunPiOptions the runner passed in, in call order. */
  calls: RunPiOptions[];
}

/**
 * Build a deterministic pi-turn fake.
 *
 * `responses` maps node id -> scripted response. The runner names sessions as
 * `${runId}-${sanitize(nodeId)}`; we recover the nodeId by stripping that
 * prefix. If no entry matches, the fake returns an empty assistant text with
 * exit code 0 (silently successful), which keeps tests focused on the cases
 * they explicitly script.
 */
export function makeFakePiAdapter(
  responsesByNodeId: Record<string, ScriptedNodeResponse>,
  runIdPrefix: string,
): FakePiAdapter {
  const calls: RunPiOptions[] = [];

  const runTurn: PiTurnFn = (opts: RunPiOptions): PiRun => {
    calls.push(opts);
    const nodeId = recoverNodeId(opts.piSessionId, runIdPrefix);
    const scripted = responsesByNodeId[nodeId] ?? {};
    const built = scripted.build ? scripted.build(opts) : {};
    const text = built.text ?? scripted.text ?? "";
    const events = built.events ?? scripted.events ?? [];
    const exitCode = built.exitCode !== undefined
      ? built.exitCode
      : scripted.exitCode !== undefined
        ? scripted.exitCode
        : 0;

    let killed = false;
    let completed = false;
    let resolveDone: (code: number | null) => void = () => undefined;
    const done = new Promise<number | null>((resolve) => {
      resolveDone = (code) => {
        completed = true;
        resolve(code);
      };
    });

    // Schedule deterministic event delivery on the next microtask. We avoid
    // setImmediate/setTimeout to keep tests fully synchronous in their
    // observable ordering once the await on `done` resolves.
    queueMicrotask(() => {
      if (killed) return;
      for (const event of events) opts.onEvent(event);
      if (text) {
        opts.onEvent({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text }],
          },
        } as unknown as PiEvent);
      }
      if (!scripted.stall) resolveDone(exitCode);
    });

    return {
      done,
      kill: () => {
        if (killed) return;
        killed = true;
        // Mirror real pi-adapter: killed runs settle with `null` (no exit code).
        resolveDone(null);
      },
      isRunning: () => !completed,
    };
  };

  return { runTurn, calls };
}

function recoverNodeId(piSessionId: string, runIdPrefix: string): string {
  const expected = runIdPrefix + "-";
  if (!piSessionId.startsWith(expected)) return piSessionId;
  return piSessionId.slice(expected.length);
}
