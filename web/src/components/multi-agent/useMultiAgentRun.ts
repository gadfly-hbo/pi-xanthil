import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import type { Flow, FlowRun, FlowRunStatus, ServerMessage } from "@/types";
import type { EditableWorkflowDef, StepState, StepStatus } from "./types";
import { basename, collectTreeDirs, describePiEvent, extractEventText, makeRunId, validateWorkflowEditor } from "./workflow-utils";

interface UseMultiAgentRunOptions {
  flow: Flow | null;
  workflow: EditableWorkflowDef | null;
  model: string;
  rulesPromptEnabled: boolean;
  knowledgePromptEnabled: boolean;
}

export function useMultiAgentRun({ flow, workflow, model, rulesPromptEnabled, knowledgePromptEnabled }: UseMultiAgentRunOptions) {
  const flowId = flow?.id ?? "";
  const [taskText, setTaskText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [gateIterations, setGateIterations] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [requestedOutputFile, setRequestedOutputFile] = useState<{ path: string; nonce: number } | null>(null);

  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  // 待映射的恢复目录：由①写入，②消费后清空。把「网络拉取」与「依赖 workflow 的纯映射」解耦，
  // 避免恢复 effect 因 workflow 每次编辑换引用而反复重跑、反复打 listFlowRuns/flowRunTree。
  const [restoreSnapshot, setRestoreSnapshot] = useState<{ dirs: Set<string>; status: FlowRunStatus; runId: string } | null>(null);

  // ① 每个 flow 只拉一次运行历史 + 判活跃 run（网络），活跃则取其目录树备映射。
  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;
    setRestoreSnapshot(null);
    api.listFlowRuns(flowId).then((rows) => {
      if (cancelled) return;
      setRuns(rows);
      const active = rows.find((r) => r.status === "running");
      const restored = active ?? rows[0];
      if (!restored) return;
      const restoredRunId = basename(restored.outputDir);
      setRunId(restoredRunId);
      setRunning(restored.status === "running");
      setLogs((cur) => cur.length > 0 ? cur : [`─ 已从历史恢复${restored.status === "running" ? "运行中" : "已结束"}状态 ${restoredRunId}`]);
      api.flowRunTree(flowId, restored.id)
        .then((tree) => {
          if (!cancelled) setRestoreSnapshot({ dirs: collectTreeDirs(tree), status: restored.status, runId: restoredRunId });
        })
        .catch(() => undefined);
    }).catch(() => { if (!cancelled) setRuns([]); });
    return () => { cancelled = true; };
  }, [flowId]);

  // ② workflow 就绪后把恢复目录映射成 step 状态（纯计算，映射一次即清空，不随后续编辑重跑）。
  useEffect(() => {
    if (!restoreSnapshot || !workflow) return;
    const created = workflow.nodes.filter((node) => restoreSnapshot.dirs.has(node.id));
    setStepStates(() => {
      const next: Record<string, StepState> = {};
      created.forEach((node, idx) => {
        const isLastCreated = idx === created.length - 1;
        const restoredStatus: StepStatus = restoreSnapshot.status === "running" && isLastCreated
          ? "running"
          : (restoreSnapshot.status === "failed" || restoreSnapshot.status === "aborted") && isLastCreated
            ? "failed"
            : "done";
        next[node.id] = { status: restoredStatus, output: "", events: [] };
      });
      return next;
    });
    const activeNode = restoreSnapshot.status === "running"
      ? [...workflow.nodes].reverse().find((node) => restoreSnapshot.dirs.has(node.id))
      : null;
    setActiveNodeId(activeNode?.id ?? null);
    setRestoreSnapshot(null);
  }, [restoreSnapshot, workflow]);

  useEffect(() => {
    if (!flowId) return;
    return gateway.subscribe((msg: ServerMessage) => {
      if (!("flowId" in msg) || msg.flowId !== flowId) return;
      if (!("runId" in msg) || msg.runId !== runIdRef.current) return;

      switch (msg.type) {
        case "run_start":
          api.listFlowRuns(flowId).then(setRuns).catch(() => undefined);
          break;
        case "agent_step_start":
          setActiveNodeId(msg.nodeId);
          setStepStates((cur) => ({
            ...cur,
            [msg.nodeId]: { status: "running", output: "", events: [] },
          }));
          setLogs((cur) => [...cur, `▶ ${msg.nodeId} 开始执行`]);
          break;
        case "agent_event": {
          const line = describePiEvent(msg.event);
          if (line) setLogs((cur) => [...cur, `[${msg.nodeId}] ${line}`]);
          setStepStates((cur) => {
            const prev = cur[msg.nodeId] ?? { status: "running" as StepStatus, output: "", events: [] };
            const text = extractEventText(msg.event);
            return {
              ...cur,
              [msg.nodeId]: {
                ...prev,
                events: [...prev.events, msg.event],
                output: text || prev.output,
              },
            };
          });
          break;
        }
        case "agent_step_end":
          setStepStates((cur) => {
            const prev = cur[msg.nodeId] ?? { status: "done" as StepStatus, output: "", events: [] };
            return { ...cur, [msg.nodeId]: { ...prev, status: msg.code === 0 ? "done" : "failed" } };
          });
          setLogs((cur) => [...cur, msg.code === 0 ? `✔ ${msg.nodeId} 完成` : `✖ ${msg.nodeId} 失败 (code=${msg.code})`]);
          break;
        case "blackboard_update":
          setStepStates((cur) => {
            const prev = cur[msg.key] ?? { status: "done" as StepStatus, output: "", events: [] };
            return { ...cur, [msg.key]: { ...prev, output: msg.value || prev.output } };
          });
          break;
        case "agent_gate":
          setGateIterations((cur) => ({ ...cur, [msg.nodeId]: (cur[msg.nodeId] ?? 0) + 1 }));
          break;
        case "run_end":
          setRunning(false);
          setActiveNodeId(null);
          setLogs((cur) => [...cur, msg.aborted ? "─ 已强制停止" : `─ 运行结束 (code=${msg.code})`]);
          api.listFlowRuns(flowId).then(setRuns).catch(() => undefined);
          break;
        case "error":
          setRunning(false);
          setLogs((cur) => [...cur, `✖ ${msg.message}`]);
          break;
      }
    });
  }, [flowId]);

  const handleRun = useCallback(() => {
    if (!flowId || !workflow || running) return;
    const firstError = validateWorkflowEditor(workflow).find((issue) => issue.level === "error");
    if (firstError) {
      setLogs((cur) => [...cur, `✖ workflow 无法运行：${firstError.message}`]);
      return;
    }
    const newRunId = makeRunId();
    setRunId(newRunId);
    setRunning(true);
    setStepStates({});
    setGateIterations({});
    setLogs([`─ 启动运行 ${newRunId}`]);
    setActiveNodeId(null);
    const inputs = taskText.trim()
      ? { task: taskText.trim(), prompt: taskText.trim(), query: taskText.trim() }
      : undefined;
    gateway.send({
      type: "execute_multi_agent",
      flowId,
      runId: newRunId,
      inputs,
      model: model || undefined,
      injectRulesPrompt: rulesPromptEnabled,
      injectKnowledgePrompt: knowledgePromptEnabled,
    });
  }, [flowId, workflow, running, model, rulesPromptEnabled, knowledgePromptEnabled, taskText]);

  const handleAbortRun = useCallback(() => {
    if (!flowId || !runId || !running) return;
    gateway.send({ type: "abort_multi_agent", flowId, runId });
    setLogs((cur) => [...cur, "─ 正在强制停止当前工作流…"]);
  }, [flowId, runId, running]);

  const openRunOutputFile = useCallback((path: string) => {
    setRequestedOutputFile({ path, nonce: Date.now() });
  }, []);

  return {
    taskText,
    setTaskText,
    runId,
    running,
    activeNodeId,
    stepStates,
    gateIterations,
    logs,
    runs,
    requestedOutputFile,
    currentOutputDir: flow && runId ? `${flow.folderPath}/runs/${runId}` : null,
    handleRun,
    handleAbortRun,
    openRunOutputFile,
  };
}
