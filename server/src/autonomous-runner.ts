import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { retrieveSkills } from "./skill-retrieval.ts";
import { runPiTurn } from "./pi-adapter.ts";
import { collectEvent, emptyMetrics, extractText } from "./evaluation-common.ts";
import { recordSkillActivationForRun } from "./db/engine.ts";
import type { AutonomousRunResult, RetrievedSkill } from "./types.ts";

export interface AutonomousRunOptions {
  workspaceRoot: string;
  workspaceId: string;
  query: string;
  model?: string;
  topK?: number;
}

export async function runAutonomousTask(opts: AutonomousRunOptions): Promise<AutonomousRunResult> {
  const { workspaceRoot, workspaceId, query, model, topK = 3 } = opts;
  const startMs = Date.now();

  const skillsUsed: RetrievedSkill[] = retrieveSkills(query, workspaceRoot, topK);
  const skillPaths = skillsUsed.map((s) => s.path);

  const runId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = join(workspaceRoot, "evaluations", "autonomous");
  mkdirSync(runDir, { recursive: true });

  let output = "";
  const run = runPiTurn({
    workspaceRoot: runDir,
    piSessionId: runId,
    text: query,
    model: model || undefined,
    skillPaths: skillPaths.length > 0 ? skillPaths : undefined,
    onEvent: (event) => {
      collectEvent(emptyMetrics(), event, { workspaceId, targetId: runId, title: "Autonomous" });
      const msg = event.type === "message_end"
        ? (event as { message?: { role?: string; content?: unknown } }).message
        : undefined;
      if (msg?.role === "assistant") {
        const next = extractText(msg.content);
        if (next) output = next;
      }
    },
  });

  const code = await run.done;
  const durationSec = (Date.now() - startMs) / 1000;

  if (code !== 0) {
    return { output, skillsUsed, durationSec, error: `进程退出码 ${String(code)}` };
  }
  // A 卡：自主完成成功后记本次注入 skill 的真实激活（生产链路之一）。
  recordSkillActivationForRun({ workspaceRoot, workspaceId, skillPaths, output });
  return { output, skillsUsed, durationSec };
}
