import { Router } from "express";

/**
 * 【Agent-E · 智能引擎域】HTTP 路由 slot —— owner: codex(GPT-5.5)
 *
 * 覆盖：Agent 对话 / 工作流 / AnaX / Eval-Harness。
 *   /api/flows* · /api/sessions* · /api/runs* · /api/hypotheses* · /api/change-proposals*
 *   /api/skill-evaluations* · /api/tool-evaluations* · /api/memory-evaluations* · /api/evaluations* …
 *
 * 约定：
 *   - 新路由写在本文件：`engineRouter.post("/api/...", (req, res) => { ... })`
 *   - 复用 runner：`import { runMultiAgent } from "../multi-agent-runner.ts"`
 *   - 复用 gate：`import { evaluateGate } from "../anax-gate.ts"`
 *   - 需访问运行时状态(activeRuns/wss) 的流式路由暂留 index.ts，待总控抽 runtime.ts
 *
 * 禁止：触碰 index.ts（legacy 冻结，归总控）/ 他域 router。
 */
export const engineRouter = Router();
