/**
 * hook-eval-core —— px-hook-runner 的纯判定内核（hook 匹配 + verdict），**零 fs / 零 spawn / 零副作用**。
 *
 * 唯一真源：扩展运行时(index.ts) 与实验场 hooks 评测(server/src/hook-evaluation-runner.ts) 共用
 * 同一 `matchesHook` / `safePreview`；`evaluateHookFixture` 忠实镜像扩展 tool_call handler 的
 * block(首个命中决定 reason) / mutate(浅合并 set 到 input 副本) / 旁路枚举语义，但**绝不执行任何动作**。
 *
 * 安全（AGENTS.md §一 等同红线）：本文件不 import fs/child_process，不 spawn、不 record、不写文件。
 * hooks lab 是"护栏单测"——只评判 verdict（matched / blocked / mutate 后 input / 会触发的 action 种类），
 * `command` 动作的真实 shell 执行只发生在扩展运行时(index.ts runSideEffect)，eval 路径永不触达。
 *
 * 此文件不在项目 tsconfig 内（随扩展由 pi 加载），故类型本地内联，与 server/src/types.ts 的 Hook 契约结构一致。
 */

export type HookActionKind = "command" | "log" | "block" | "mutate" | "notify";
export interface HookAction {
  kind: HookActionKind;
  command?: string;
  reason?: string;
  set?: Record<string, string>;
}
export interface HookMatch { toolName?: string; pattern?: string }
export interface Hook {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  match?: HookMatch;
  action: HookAction;
}

// 纯 verdict（无副作用执行）。
export interface HookVerdict {
  matchedHookIds: string[];
  blocked: boolean;
  blockReason: string | null;
  mutatedInput: Record<string, unknown> | null;   // 有 mutate 命中且 input 可改时=应用 set 后的副本；否则 null
  sideEffectKinds: string[];                       // 会触发的旁路动作种类(command/notify/log)——仅枚举，绝不执行
  triggerCount: number;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// 安全参数预览：只挑低敏感、对匹配有用的字段，绝不 dump 完整 message/tool 内容。
export function safePreview(event: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {};
  for (const k of ["toolName", "turnIndex", "reason", "role", "isError"]) {
    if (k in event) picked[k] = event[k];
  }
  const args = (event.args ?? event.input) as Record<string, unknown> | undefined;
  if (args && typeof args === "object" && typeof args.command === "string") {
    picked.command = truncate(args.command, 120);
  }
  return truncate(JSON.stringify(picked), 200);
}

export function matchesHook(hook: Hook, event: Record<string, unknown>, preview: string): boolean {
  const m = hook.match;
  if (!m) return true;
  if (m.toolName && event.toolName !== m.toolName) return false;
  if (m.pattern) {
    try {
      if (!new RegExp(m.pattern).test(preview)) return false;
    } catch {
      return false; // 非法正则 → 不命中
    }
  }
  return true;
}

function cloneInput(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : null;
}

/**
 * 纯判定：给定 hooks(任意集合) + 事件名 + 合成 payload，算出 verdict。
 * 镜像扩展语义：先按 `enabled && event===eventName` 过滤；非 tool_call 事件忽略 block/mutate（仅旁路）。
 * tool_call：block 首个命中决定 reason；mutate 把 set 浅合并进 input 副本；其余(command/log/notify)计入 sideEffectKinds。
 * 绝不执行任何动作。
 */
export function evaluateHookFixture(hooks: Hook[], eventName: string, payload: Record<string, unknown>): HookVerdict {
  const preview = safePreview(payload);
  const isToolCall = eventName === "tool_call";
  const candidates = hooks.filter((h) =>
    h && h.enabled && h.event === eventName
    && (isToolCall || (h.action.kind !== "block" && h.action.kind !== "mutate")),
  );

  const matchedHookIds: string[] = [];
  const sideEffectKinds: string[] = [];
  let blocked = false;
  let blockReason: string | null = null;
  let mutatedInput: Record<string, unknown> | null = null;

  for (const hook of candidates) {
    if (!matchesHook(hook, payload, preview)) continue;
    matchedHookIds.push(hook.id);
    const kind = hook.action.kind;
    if (isToolCall && kind === "block") {
      if (!blocked) {
        blocked = true;
        blockReason = hook.action.reason || `blocked by hook ${hook.id}`;
      }
    } else if (isToolCall && kind === "mutate") {
      const base: Record<string, unknown> | null = mutatedInput ?? cloneInput(payload.input);
      if (base && hook.action.set) {
        for (const [k, v] of Object.entries(hook.action.set)) base[k] = v;
        mutatedInput = base;
      }
    } else {
      sideEffectKinds.push(kind);
    }
  }

  return { matchedHookIds, blocked, blockReason, mutatedInput, sideEffectKinds, triggerCount: matchedHookIds.length };
}
