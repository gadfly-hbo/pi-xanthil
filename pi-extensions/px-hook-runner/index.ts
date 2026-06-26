/**
 * px-hook-runner —— pi-xanthil 声明式 hook 转发扩展（计算工具·hooks 管理）。
 *
 * 机制：pi 的 hook = 扩展事件订阅。本扩展运行时读 hooks.json（PX_HOOKS_CONFIG），
 * 对每个 pi 生命周期事件匹配用户定义的规则，执行动作，并把每次触发写入
 * hooks-triggers.jsonl（PX_HOOKS_LOG）供运行看板消费。
 *
 * 动作类型（护栏 + 传感器）：
 *   - block  （Pre-action 护栏，仅 tool_call）：命中即 return { block, reason } 拒绝工具执行。
 *   - mutate （仅 tool_call）：把 action.set 浅合并进 event.input，改写工具参数。
 *   - command（Post-action 传感器）：跑本地 shell（格式化/测试/记 trace）。
 *   - notify （Notification）：本地系统通知（macOS osascript；非 darwin 退化为只记日志）。
 *   - log    ：仅落一条触发记录。
 *
 * 数据安全（AGENTS.md §一 等同红线对待）：
 *   - 不实现任何外发(HTTP)动作。
 *   - block 为纯防御（拒危险命令/越权路径），确定性规则、无需人确认，-p 模式可用。
 *   - trigger 流水只记事件元数据 + 截断的参数预览，不落完整 message/tool 内容。
 *
 * 加载方式：由 server/src/pi-adapter.ts 以 `pi -e <此文件>` 注入，仅作用于 pi-xanthil 触发的 pi 进程。
 * pi 原生加载 .ts，无需编译。契约见 server/src/types.ts 的 Hook / HookTriggerRecord。
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
// hook 匹配/verdict 判定内核（与实验场 hooks 评测共用同一 matchesHook/safePreview，唯一真源；本文件保留 record/runSideEffect 执行）。
import {
  BUILTIN_WEB_SEARCH_GUARD_ID,
  WEB_SEARCH_BLOCK_REASON,
  isWebSearchToolCall,
  type Hook,
  safePreview,
  matchesHook,
} from "./hook-eval-core.ts";

// pi 扩展 API 的最小本地形状（避免引入 @earendil-works/pi-coding-agent 运行时依赖）。
interface PiExtAPI {
  on: (
    event: string,
    handler: (event: Record<string, unknown>, ctx: PiHandlerCtx) => unknown,
  ) => void;
}
interface PiHandlerCtx {
  sessionManager?: {
    getSessionId?: () => string | null;
    getSessionFile?: () => string | null;
  };
}

const CONFIG_PATH = process.env.PX_HOOKS_CONFIG ?? "";
const LOG_PATH = process.env.PX_HOOKS_LOG ?? "";

// MVP 支持的 pi 事件集。
const SUPPORTED_EVENTS = [
  "session_start",
  "session_shutdown",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "tool_call",
  "message_end",
] as const;

function loadHooks(): Hook[] {
  if (!CONFIG_PATH) return [];
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as Hook[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { hooks?: unknown }).hooks)) {
      return (parsed as { hooks: Hook[] }).hooks;
    }
    return [];
  } catch {
    return []; // 文件不存在 / 解析失败 → 视为无 hook
  }
}

function record(rec: Record<string, unknown>): void {
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, `${JSON.stringify(rec)}\n`);
  } catch {
    /* best-effort：日志失败不影响 agent */
  }
}

function getSessionId(ctx: PiHandlerCtx): string {
  const sm = ctx.sessionManager;
  const id = sm?.getSessionId?.();
  if (id) return id;
  const file = sm?.getSessionFile?.();
  return file ? (file.split(/[\\/]/).pop() ?? "") : "";
}

// command / notify / log —— 旁路副作用（不影响 pi 行为），异步 fire-and-forget。
function runSideEffect(hook: Hook, eventName: string, event: Record<string, unknown>, preview: string, sessionId: string): void {
  const started = Date.now();
  const base = { ts: started, hookId: hook.id, event: eventName, matched: true, sessionId, argsPreview: preview };

  if (hook.action.kind === "command" && hook.action.command) {
    const child = spawn("sh", ["-c", hook.action.command], {
      stdio: "ignore",
      env: {
        ...process.env,
        HOOK_EVENT: eventName,
        HOOK_TOOL_NAME: typeof event.toolName === "string" ? event.toolName : "",
        HOOK_SESSION_ID: sessionId,
        HOOK_ARGS_PREVIEW: preview,
      },
    });
    child.on("close", (code) => record({ ...base, actionKind: "command", ok: code === 0, exitCode: code ?? -1, durationMs: Date.now() - started }));
    child.on("error", () => record({ ...base, actionKind: "command", ok: false, exitCode: -1, durationMs: Date.now() - started }));
    return;
  }

  if (hook.action.kind === "notify") {
    const msg = hook.action.reason || `${hook.name} · ${eventName}`;
    if (process.platform === "darwin") {
      const script = `display notification ${JSON.stringify(msg)} with title "pi-xanthil hook"`;
      const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
      child.on("close", (code) => record({ ...base, actionKind: "notify", ok: code === 0, exitCode: code ?? -1, durationMs: Date.now() - started, reason: msg }));
      child.on("error", () => record({ ...base, actionKind: "notify", ok: false, exitCode: -1, durationMs: Date.now() - started, reason: msg }));
    } else {
      // 非 darwin：退化为只记一条（看板仍可见，pi-xanthil 侧另行高亮）。
      record({ ...base, actionKind: "notify", ok: true, durationMs: 0, reason: msg });
    }
    return;
  }

  // log（含缺命令的 command）→ 直接落一条记录。
  record({ ...base, actionKind: hook.action.kind, ok: true, durationMs: 0, ...(hook.action.reason ? { reason: hook.action.reason } : {}) });
}

// mutate：把 action.set 浅合并进 tool input（仅 tool_call；pi 文档：event.input 可变，改后无再校验）。
function applyMutate(event: Record<string, unknown>, set: Record<string, string> | undefined): boolean {
  if (!set) return false;
  const input = event.input;
  if (!input || typeof input !== "object") return false;
  for (const [k, v] of Object.entries(set)) (input as Record<string, unknown>)[k] = v;
  return true;
}

export default function (pi: PiExtAPI): void {
  // tool_call：唯一的护栏/改参点，需同步求值并返回 { block, reason }。
  pi.on("tool_call", (event, ctx) => {
    const safeEvent = event ?? {};
    const hooks = loadHooks().filter((h) => h && h.enabled && h.event === "tool_call");
    if (hooks.length === 0) return;
    const preview = safePreview(safeEvent);
    const sessionId = getSessionId(ctx);
    let blockReason: string | null = null;

    if (isWebSearchToolCall(safeEvent, preview) && process.env.PX_ALLOW_WEB !== "1") {
      blockReason = WEB_SEARCH_BLOCK_REASON;
      record({
        ts: Date.now(),
        hookId: BUILTIN_WEB_SEARCH_GUARD_ID,
        event: "tool_call",
        matched: true,
        actionKind: "block",
        ok: true,
        durationMs: 0,
        sessionId,
        argsPreview: preview,
        reason: WEB_SEARCH_BLOCK_REASON,
        blocked: true,
      });
    }

    for (const hook of hooks) {
      if (!matchesHook(hook, safeEvent, preview)) continue;
      const kind = hook.action.kind;
      if (kind === "block") {
        const reason = hook.action.reason || `blocked by hook ${hook.id}`;
        if (blockReason === null) blockReason = reason; // 首个命中的 block 决定
        record({ ts: Date.now(), hookId: hook.id, event: "tool_call", matched: true, actionKind: "block", ok: true, durationMs: 0, sessionId, argsPreview: preview, reason, blocked: true });
      } else if (kind === "mutate") {
        const applied = applyMutate(safeEvent, hook.action.set);
        record({ ts: Date.now(), hookId: hook.id, event: "tool_call", matched: true, actionKind: "mutate", ok: applied, durationMs: 0, sessionId, argsPreview: preview });
      } else {
        runSideEffect(hook, "tool_call", safeEvent, preview, sessionId);
      }
    }

    if (blockReason !== null) return { block: true, reason: blockReason };
  });

  // 其余事件：仅旁路副作用（block/mutate 在这些事件无效，UI 已限制选择，runner 兜底忽略）。
  for (const eventName of SUPPORTED_EVENTS) {
    if (eventName === "tool_call") continue;
    pi.on(eventName, (event, ctx) => {
      const safeEvent = event ?? {};
      const hooks = loadHooks().filter((h) => h && h.enabled && h.event === eventName && h.action.kind !== "block" && h.action.kind !== "mutate");
      if (hooks.length === 0) return;
      const preview = safePreview(safeEvent);
      const sessionId = getSessionId(ctx);
      for (const hook of hooks) {
        if (matchesHook(hook, safeEvent, preview)) runSideEffect(hook, eventName, safeEvent, preview, sessionId);
      }
    });
  }
}
