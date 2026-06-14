import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, CheckCircle2, Cpu, Loader2, Play, RefreshCw, Square, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { gateway } from "@/lib/ws";
import { asBlocks, textOf, type Flow, type PiEvent, type PiModel, type ServerMessage, type StoredFlowMessage, type WorkflowDef } from "@/types";
import type { UiMessage } from "@/components/MessageRow";

interface Props {
  flow: Flow;
  models: PiModel[];
  model: string;
  onModelChange: (model: string) => void;
  onApplyToEditor: () => void;
  rulesPromptEnabled: boolean;
}

interface DesignForm {
  goal: string;
  inputs: string;
  steps: string;
  gates: string;
  outputs: string;
}

const DESIGN_SYSTEM_PROMPT = `你是一个多智能体 workflow 设计器。用户会提交一份表单式工作流设计，请严格基于表单生成当前 flow 根目录下的 workflow.json。

约束：
1. 用户给出的“流程步骤”是主要结构来源，必须尽量保留节点边界、顺序、命名、输入输出 key
2. agent/tool/gate 三类节点优先按用户标注识别；未标注时默认 agent
3. 自动生成 edges：默认按步骤顺序串联；如果用户写了“回到/重试/不通过返回”，为 gate 写 onBlock.retryFromNodeId 和 maxIterations
4. tool 节点写 kind:"tool"，缺失字段用保守占位：inputPath="{{input.file}}"、outputDir="output"、timeoutMs=60000
5. gate 节点写 kind:"gate"，prompt 清楚说明 pass/block 判定；最多 N 轮写入 onBlock.maxIterations
6. agent prompt 使用 {{task}} 或上游输出引用，不要把业务数据样本写入 workflow.json
7. 每个节点设置 id、label、role、icon、color、desc；id 使用英文 kebab-case 或 snake_case
8. 最终必须生成或更新 workflow.json 到当前工作目录，也就是本次 flow 的根目录

workflow.json 格式：
{ "version": 1, "defaultModel": "", "nodes": [{ "id": "...", "label": "...", "prompt": "...", "model": "", "kind": "agent|tool|gate", "role": "...", "icon": "🤖", "color": "#0ea5e9", "desc": "...", "outputKey": "..." }], "edges": [{ "id": "e1", "source": "...", "target": "..." }] }`;

const PATCH_SYSTEM_PROMPT = `你是一个 workflow 局部修改器。当前 flow 根目录可能已有 workflow.json。用户输入的是“修改指令”，不是重新生成。

必须遵守：
1. 先读取当前 flow 根目录下的 workflow.json
2. 只做用户要求的最小修改，尽量保留既有节点 id、edges、prompt、模型和工具配置
3. 如果用户要求插入/删除/拆分/合并节点，同步更新 edges 和 gate 的 onBlock.retryFromNodeId
4. 如果用户要求 gate 回跳或最多 N 轮，写入 onBlock.retryFromNodeId 和 onBlock.maxIterations
5. 修改后写回当前 flow 根目录 workflow.json
6. 回复中简短说明改了哪些节点；不要重写整套方法论`;

const EXAMPLES: Array<{ label: string; form: DesignForm }> = [
  {
    label: "写作工作流",
    form: {
      goal: "创建一个写作工作流，从选题到终稿输出。",
      inputs: "输入是用户给定的写作主题、受众、篇幅和风格要求。不要引入未确认的事实。",
      steps: `1. agent：选题分析
   输入：{{task}}
   输出：topic_brief

2. agent：生成大纲
   输入：topic_brief
   输出：outline

3. agent：撰写初稿
   输入：outline
   输出：draft

4. gate：初稿质量门禁
   检查：draft 是否结构完整、观点清楚、没有明显跑题
   不通过：回到「撰写初稿」
   最多：3 轮

5. agent：润色定稿
   输入：draft
   输出：final_article`,
      gates: "初稿质量门禁不通过时回到撰写初稿，最多 3 轮。",
      outputs: "最终输出 final_article，包含标题、正文和可选摘要。",
    },
  },
  {
    label: "SQL loop",
    form: {
      goal: "根据用户问题生成 SQL，执行失败或结果不合格时自动重写。",
      inputs: "输入是用户问题、表结构说明和 SQL 连接信息。运行前需先配置 SQL 连接。",
      steps: `1. agent：SQL 分析计划
   输入：{{task}}
   输出：plan

2. agent：生成 SQL
   输入：plan
   输出：sql

3. tool：执行 SQL
   输入：sql
   输出：run_sql

4. gate：SQL 结果门禁
   检查：run_sql 是否执行成功，且结果能回答问题
   不通过：回到「生成 SQL」
   最多：5 轮`,
      gates: "SQL 结果门禁失败时回到生成 SQL，最多 5 轮。",
      outputs: "输出可执行 SQL、查询结果摘要和失败原因。",
    },
  },
];

const PATCH_EXAMPLES = [
  "把“生成大纲”和“撰写初稿”之间插入一个“观点提炼”节点，输出 key 为 point_of_view。",
  "给“初稿质量门禁”增加回跳，失败时回到“撰写初稿”，最多 3 轮。",
  "把“润色定稿”拆成“语言润色”和“事实核查”两个节点。",
];

function ModelSelect({ models, value, onChange }: { models: PiModel[]; value: string; onChange: (value: string) => void }) {
  const groups = models.reduce<Record<string, PiModel[]>>((acc, item) => {
    (acc[item.provider] ??= []).push(item);
    return acc;
  }, {});
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 rounded-md border border-neutral-200 bg-transparent px-2 text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
    >
      {Object.entries(groups).map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((item) => <option key={item.id} value={item.id}>{item.model}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function buildDesignPrompt(form: DesignForm): string {
  return `请根据以下表单生成 workflow.json。

## 工作流目标
${form.goal.trim() || "未填写，请使用通用默认目标并保持保守。"}

## 输入与上下文
${form.inputs.trim() || "未填写。"}

## 流程步骤
${form.steps.trim() || "未填写，请根据目标生成 3-5 个基础 agent 节点。"}

## 质量门禁 / 回跳
${form.gates.trim() || "未填写。"}

## 最终输出
${form.outputs.trim() || "未填写。"}

请写入当前 flow 根目录的 workflow.json。`;
}

export function WorkflowDesignPane(p: Props) {
  const [form, setForm] = useState<DesignForm>({ goal: "", inputs: "", steps: "", gates: "", outputs: "" });
  const [patchText, setPatchText] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const flowIdRef = useRef(p.flow.id);
  flowIdRef.current = p.flow.id;

  const hasWorkflow = Boolean(workflow && workflow.nodes.length > 0);
  const lastAssistantText = useMemo(() => {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    return last ? textOf(last.content).trim() : "";
  }, [messages]);

  const refreshWorkflow = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.flowWorkflowGet(p.flow.id);
      setWorkflow(result.workflow);
    } catch {
      setWorkflow(null);
    } finally {
      setRefreshing(false);
    }
  }, [p.flow.id]);

  const refreshRuntime = useCallback(async () => {
    try {
      const runtime = await api.getFlowChatRuntime(p.flow.id);
      setRunning(runtime.running);
      if (!runtime.running) void refreshWorkflow();
    } catch {
      setRunning(false);
    }
  }, [p.flow.id, refreshWorkflow]);

  useEffect(() => {
    api.listFlowMessages(p.flow.id)
      .then((rows: StoredFlowMessage[]) => setMessages(rows.map((row) => ({ id: String(row.id), role: row.role, content: asBlocks(row.content) }))))
      .catch(() => setMessages([]));
    void refreshWorkflow();
    void refreshRuntime();
  }, [p.flow.id, refreshRuntime, refreshWorkflow]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refreshRuntime(), 1500);
    return () => window.clearInterval(timer);
  }, [refreshRuntime, running]);

  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (msg.type === "run_start" && !msg.runId && msg.flowId === flowIdRef.current) {
        setRunning(true);
      } else if (msg.type === "run_end" && !msg.runId && msg.flowId === flowIdRef.current) {
        setRunning(false);
        void refreshWorkflow();
      } else if (msg.type === "error" && !msg.runId && msg.flowId === flowIdRef.current) {
        setRunning(false);
        setMessages((current) => [...current, { id: `err-${Date.now()}`, role: "assistant", content: [], error: msg.message }]);
      } else if (msg.type === "flow_event" && msg.flowId === flowIdRef.current && msg.event.type === "message_end") {
        const event = msg.event as Extract<PiEvent, { type: "message_end" }>;
        if (event.message.role === "user") return;
        setMessages((current) => [
          ...current,
          { id: `m-${Date.now()}`, role: event.message.role, content: asBlocks(event.message.content), error: event.message.errorMessage },
        ]);
        void refreshWorkflow();
      }
    });
  }, [refreshWorkflow]);

  const sendFlow = useCallback((text: string, systemPrompt: string) => {
    setRunning(true);
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", content: [{ type: "text", text }] }]);
    gateway.send({
      type: "send_flow",
      flowId: p.flow.id,
      text,
      model: p.model || undefined,
      systemPrompt,
      injectRulesPrompt: p.rulesPromptEnabled,
    });
  }, [p.flow.id, p.model, p.rulesPromptEnabled]);

  const generateWorkflow = useCallback(() => {
    if (running) return;
    sendFlow(buildDesignPrompt(form), DESIGN_SYSTEM_PROMPT);
  }, [form, running, sendFlow]);

  const applyPatch = useCallback(() => {
    const text = patchText.trim();
    if (!text || running) return;
    sendFlow(`请基于当前 workflow.json 做以下最小修改：\n\n${text}`, PATCH_SYSTEM_PROMPT);
    setPatchText("");
  }, [patchText, running, sendFlow]);

  const stop = useCallback(() => {
    gateway.send({ type: "abort_flow", flowId: p.flow.id });
  }, [p.flow.id]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
          <section className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <Wand2 className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">工作流设计表单</h2>
                <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">先把目标、输入、步骤和 gate 想清楚，再生成 workflow.json。</p>
              </div>
              <div className="flex items-center gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    onClick={() => setForm(example.form)}
                    disabled={running}
                    className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3">
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  描述目标和需求
                  <textarea
                    value={form.goal}
                    onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
                    rows={4}
                    placeholder="这个工作流要解决什么问题？最终希望产出什么？"
                    className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  输入与上下文
                  <textarea
                    value={form.inputs}
                    onChange={(event) => setForm((current) => ({ ...current, inputs: event.target.value }))}
                    rows={4}
                    placeholder="输入数据、文件、用户任务、业务规则、限制条件、不能做的事。"
                    className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  最终输出
                  <textarea
                    value={form.outputs}
                    onChange={(event) => setForm((current) => ({ ...current, outputs: event.target.value }))}
                    rows={3}
                    placeholder="最终要输出哪些文件、字段或结论？"
                    className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  描述节点、步骤、gate、回跳
                  <textarea
                    value={form.steps}
                    onChange={(event) => setForm((current) => ({ ...current, steps: event.target.value }))}
                    rows={12}
                    placeholder={"1. agent：分析计划\n   输入：{{task}}\n   输出：plan\n\n2. tool：执行工具\n   输入：plan\n   输出：tool_result\n\n3. gate：质量门禁\n   检查：...\n   不通过：回到「分析计划」\n   最多：3 轮"}
                    className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 font-mono text-[12px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  质量门禁 / 回跳补充
                  <textarea
                    value={form.gates}
                    onChange={(event) => setForm((current) => ({ ...current, gates: event.target.value }))}
                    rows={3}
                    placeholder="哪些节点需要 gate？失败后回到哪里？最多几轮？"
                    className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <label className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                <Cpu className="h-3.5 w-3.5" strokeWidth={1.75} />
                {p.models.length > 0 ? <ModelSelect models={p.models} value={p.model} onChange={p.onModelChange} /> : "模型加载中"}
              </label>
              {hasWorkflow && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  已有 {workflow?.nodes.length ?? 0} 个节点
                </span>
              )}
              <button
                onClick={running ? stop : generateWorkflow}
                disabled={!running && !form.goal.trim() && !form.steps.trim()}
                className={cn(
                  "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium",
                  !running && !form.goal.trim() && !form.steps.trim()
                    ? "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                    : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                )}
              >
                {running ? <Square className="h-3 w-3" fill="currentColor" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />}
                {running ? "停止" : hasWorkflow ? "重新生成工作流" : "生成工作流"}
              </button>
              {hasWorkflow && (
                <button
                  onClick={p.onApplyToEditor}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                  切换到执行
                </button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <h2 className="shrink-0 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">迭代修改</h2>
                <span
                  title={`${p.flow.name}${p.flow.sourceName ? ` / ${p.flow.sourceName}` : ""}`}
                  className="min-w-0 truncate rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                >
                  当前修改：{p.flow.name}{p.flow.sourceName ? ` / ${p.flow.sourceName}` : ""}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-neutral-500 dark:text-neutral-400">已有 workflow 后，用自然语言描述局部调整；系统会尽量保留现有节点，只做最小修改。</p>
            </div>
            <div className="p-4">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PATCH_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setPatchText(example)}
                    disabled={running}
                    className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={patchText}
                  onChange={(event) => setPatchText(event.target.value)}
                  rows={3}
                  placeholder="例如：给“初稿质量门禁”增加回跳，失败时回到“撰写初稿”，最多 3 轮。"
                  className="min-h-[74px] flex-1 resize-y rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100"
                />
                <button
                  onClick={applyPatch}
                  disabled={running || !patchText.trim() || !hasWorkflow}
                  className={cn(
                    "h-8 rounded-md px-3 text-[12px] font-medium",
                    running || !patchText.trim() || !hasWorkflow
                      ? "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                      : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
                  )}
                >
                  应用修改
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50/50 dark:border-neutral-800 dark:bg-neutral-950/60">
        <div className="flex h-10 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">生成状态</span>
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" strokeWidth={1.75} />}
          <button
            onClick={() => void refreshWorkflow()}
            disabled={refreshing}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="刷新 workflow"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} strokeWidth={1.75} />
          </button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          {lastAssistantText ? (
            <div className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-3 text-[12px] leading-5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
              {lastAssistantText}
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">提交设计表单后，这里会显示 pi 的生成或修改结果。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
