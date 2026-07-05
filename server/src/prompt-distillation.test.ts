import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPromptDistillationTarget,
  collectLatestSuccessfulTurn,
  parsePromptDraft,
  runPromptDistillation,
} from "./prompt-distillation.ts";
import type { StoredMessage } from "./types.ts";

function message(id: number, role: StoredMessage["role"], text: string, errorMessage: string | null = null): StoredMessage {
  return {
    id,
    sessionId: "session-1",
    role,
    content: [{ type: "text", text }],
    usage: null,
    errorMessage,
    createdAt: id,
  };
}

test("collectLatestSuccessfulTurn does not fall back when the latest user turn failed", () => {
  const turn = collectLatestSuccessfulTurn([
    message(1, "user", "旧任务"),
    message(2, "assistant", "旧结果"),
    message(3, "user", "新任务"),
    message(4, "assistant", "失败结果", "provider failed"),
  ]);
  assert.equal(turn, null);
});

test("collectLatestSuccessfulTurn selects the latest completed user turn", () => {
  const turn = collectLatestSuccessfulTurn([
    message(1, "user", "旧任务"),
    message(2, "assistant", "旧结果"),
    message(3, "user", "新任务"),
    message(4, "assistant", "新结果"),
  ]);
  assert.deepEqual(turn, { user: "新任务", assistant: "新结果" });
});

test("collectPromptDistillationTarget selects a specific completed turn only", () => {
  const target = collectPromptDistillationTarget([
    message(1, "user", "第一轮任务"),
    message(2, "assistant", "第一轮结果"),
    message(3, "user", "第二轮任务"),
    message(4, "assistant", "第二轮结果"),
  ], { type: "turn", userMessageId: 1 });
  assert.deepEqual(target, { kind: "turn", user: "第一轮任务", assistant: "第一轮结果" });
});

test("collectPromptDistillationTarget can build a whole-session transcript", () => {
  const target = collectPromptDistillationTarget([
    message(1, "user", "第一轮任务"),
    message(2, "assistant", "第一轮结果"),
    message(3, "user", "第二轮任务"),
    message(4, "assistant", "第二轮结果"),
  ], { type: "session" });
  assert.equal(target?.kind, "session");
  assert.match(target?.transcript ?? "", /第一轮任务/);
  assert.match(target?.transcript ?? "", /第二轮结果/);
});

test("collectPromptDistillationTarget can build a selected-turns transcript", () => {
  const target = collectPromptDistillationTarget([
    message(1, "user", "第一轮任务"),
    message(2, "assistant", "第一轮结果"),
    message(3, "user", "第二轮任务"),
    message(4, "assistant", "第二轮结果"),
    message(5, "user", "第三轮任务"),
    message(6, "assistant", "第三轮结果"),
  ], { type: "turns", userMessageIds: [1, 5] });
  assert.equal(target?.kind, "turns");
  assert.match(target?.transcript ?? "", /第一轮任务/);
  assert.doesNotMatch(target?.transcript ?? "", /第二轮任务/);
  assert.match(target?.transcript ?? "", /第三轮结果/);
});

test("parsePromptDraft normalizes variables from actual body placeholders", () => {
  const draft = parsePromptDraft(`---
title: 区域指标分析
category: 数据分析
variables: unused, region, metric
tags: 分析, 指标
---
请分析 {{ region }} 的 {{metric}}，并按表格输出；再次核对 {{region}}。`, "session-1");
  assert.deepEqual(draft, {
    title: "区域指标分析",
    category: "数据分析",
    body: "请分析 {{ region }} 的 {{metric}}，并按表格输出；再次核对 {{region}}。",
    variables: ["region", "metric"],
    tags: ["分析", "指标"],
    sourceSessionId: "session-1",
  });
});

test("runPromptDistillation returns null without a successful user-assistant turn and skips LLM", async () => {
  let calls = 0;
  const draft = await runPromptDistillation({
    workspaceRoot: "/tmp",
    sessionId: "session-1",
    messages: [message(1, "user", "只有用户消息")],
    distillText: async () => {
      calls++;
      return "NO_DRAFT";
    },
  });
  assert.equal(draft, null);
  assert.equal(calls, 0);
});

test("runPromptDistillation creates a draft without writing storage", async () => {
  let receivedPrompt = "";
  const draft = await runPromptDistillation({
    workspaceRoot: "/tmp",
    sessionId: "session-1",
    messages: [message(1, "user", "分析华东销售额"), message(2, "assistant", "分析完成")],
    distillText: async (prompt) => {
      receivedPrompt = prompt;
      return `---
title: 区域销售分析
category: 数据分析
variables: region, metric
tags: 销售, 区域
---
分析 {{region}} 的 {{metric}} 并输出结论。`;
    },
  });
  assert.match(receivedPrompt, /分析华东销售额/);
  assert.equal(draft?.body, "分析 {{region}} 的 {{metric}} 并输出结论。");
  assert.equal(draft?.sourceSessionId, "session-1");
});

test("runPromptDistillation passes selected session scope to the distiller", async () => {
  let receivedPrompt = "";
  const draft = await runPromptDistillation({
    workspaceRoot: "/tmp",
    sessionId: "session-1",
    messages: [message(1, "user", "任务一"), message(2, "assistant", "结果一"), message(3, "user", "任务二"), message(4, "assistant", "结果二")],
    scope: { type: "session" },
    distillText: async (prompt) => {
      receivedPrompt = prompt;
      return `---
title: Session 方法
category: 工作流
variables:
tags: session
---
复用整个 session 的方法。`;
    },
  });
  assert.match(receivedPrompt, /整个 session/);
  assert.match(receivedPrompt, /任务一/);
  assert.match(receivedPrompt, /结果二/);
  assert.equal(draft?.title, "Session 方法");
});

test("runPromptDistillation passes selected turns scope to the distiller", async () => {
  let receivedPrompt = "";
  const draft = await runPromptDistillation({
    workspaceRoot: "/tmp",
    sessionId: "session-1",
    messages: [message(1, "user", "任务一"), message(2, "assistant", "结果一"), message(3, "user", "任务二"), message(4, "assistant", "结果二")],
    scope: { type: "turns", userMessageIds: [3] },
    distillText: async (prompt) => {
      receivedPrompt = prompt;
      return `---
title: 多轮方法
category: 工作流
variables:
tags: selected
---
复用选定轮次的方法。`;
    },
  });
  assert.match(receivedPrompt, /选定的多轮对话/);
  assert.doesNotMatch(receivedPrompt, /任务一/);
  assert.match(receivedPrompt, /任务二/);
  assert.equal(draft?.title, "多轮方法");
});
