import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, FileText, Folder, Loader2, Play, Workflow, XCircle } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { cn } from "@/lib/cn";
import type { Flow, FlowRun, FlowTreeNode, PiEvent, PiModel, ServerMessage } from "@/types";

interface Props {
  flow: Flow | null;
  model: string;
  models: PiModel[];
  onModelChange: (m: string) => void;
}

type InputDef = { name: string; type: "string" | "enum"; required: boolean; defaultValue?: string; options?: string[]; description?: string };

function extractText(content: unknown[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseReadmeInputs(md: string): InputDef[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Inputs\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const out: InputDef[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;
    if (/^##\s+/.test(line)) break;
    const m = line.match(/^[-*]\s+`([^`]+)`\s*\(([^)]+)\)\s*:\s*(.+)$/);
    if (!m) continue;
    const name = m[1] ?? "";
    const meta = m[2] ?? "";
    const desc = m[3] ?? "";
    if (!name || !meta) continue;
    const lower = meta.toLowerCase();
    const enumMatch = lower.match(/enum\[([^\]]+)\]/);
    out.push({
      name,
      type: enumMatch ? "enum" : "string",
      options: enumMatch ? (enumMatch[1] ?? "").split("|").map((s) => s.trim()).filter(Boolean) : undefined,
      required: /required/.test(lower),
      defaultValue: (meta.match(/default\s*=\s*([^,]+)/i)?.[1] ?? "").trim() || undefined,
      description: desc,
    });
  }
  return out;
}

function parseYamlInputs(yaml: string): InputDef[] {
  const lines = yaml.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: InputDef[] = [];
  let cur: Partial<InputDef> | null = null;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const item = line.match(/^-\s+name:\s*(.+)$/);
    if (item) {
      if (cur?.name) out.push({ name: cur.name, type: cur.type ?? "string", required: !!cur.required, defaultValue: cur.defaultValue, options: cur.options, description: cur.description });
      cur = { name: item[1]!.trim() };
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const val = kv[2]!.trim();
    if (key === "type") {
      if (val.startsWith("enum[")) {
        cur.type = "enum";
        cur.options = val.replace(/^enum\[/, "").replace(/\]$/, "").split("|").map((s) => s.trim());
      } else cur.type = "string";
    } else if (key === "required") cur.required = val === "true";
    else if (key === "default") cur.defaultValue = val;
    else if (key === "description") cur.description = val;
  }
  if (cur?.name) out.push({ name: cur.name, type: cur.type ?? "string", required: !!cur.required, defaultValue: cur.defaultValue, options: cur.options, description: cur.description });
  return out;
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  const out: FlowTreeNode[] = [];
  const walk = (n: FlowTreeNode) => {
    if (n.kind === "file") out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

function TreeView({ node, onPick }: { node: FlowTreeNode; onPick: (path: string) => void }) {
  return (
    <div className="text-xs">
      {(node.children ?? []).map((c) => (
        <TreeNode key={c.path} node={c} depth={0} onPick={onPick} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, onPick }: { node: FlowTreeNode; depth: number; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${8 + depth * 12}px` };
  if (node.kind === "file") {
    return (
      <button onClick={() => onPick(node.path)} style={pad} className="flex w-full items-center gap-1 rounded py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <FileText className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} style={pad} className="flex w-full items-center gap-1 rounded py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronRight className={cn("h-3.5 w-3.5 text-neutral-500 transition-transform", open && "rotate-90")} strokeWidth={1.75} />
        <Folder className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (node.children ?? []).map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onPick={onPick} />)}
    </div>
  );
}

export function ExecutionPane(p: Props) {
  const [defs, setDefs] = useState<InputDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runTree, setRunTree] = useState<FlowTreeNode | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");

  useEffect(() => {
    if (!p.flow) return;
    api.listFlowRuns(p.flow.id).then(setRuns).catch(() => setRuns([]));
  }, [p.flow]);

  useEffect(() => {
    if (!p.flow) return;
    const flowId = p.flow.id;
    (async () => {
      try {
        const [yamlRes, readmeRes] = await Promise.allSettled([
          api.flowFileGet(flowId, ".pi/inputs.yaml"),
          api.flowFileGet(flowId, "README.md"),
        ]);
        const yamlDefs = yamlRes.status === "fulfilled" ? parseYamlInputs(yamlRes.value.content) : [];
        const readmeDefs = readmeRes.status === "fulfilled" ? parseReadmeInputs(readmeRes.value.content) : [];
        const merged = [...yamlDefs, ...readmeDefs.filter((r) => !yamlDefs.some((y) => y.name === r.name))];
        setDefs(merged);
        const next: Record<string, string> = {};
        for (const d of merged) next[d.name] = d.defaultValue ?? "";
        setValues(next);
      } catch {
        setDefs([]);
      }
    })();
  }, [p.flow]);

  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      if (!p.flow) return;
      if (msg.type === "run_start" && msg.flowId === p.flow.id && msg.runId) {
        setRunId(msg.runId);
        setSelectedRunId(msg.runId);
        setEvents([]);
        setRunning(true);
      } else if (msg.type === "flow_run_event" && msg.flowId === p.flow.id && msg.runId === runId) {
        setEvents((cur) => [...cur, msg.event]);
      } else if (msg.type === "run_end" && msg.flowId === p.flow.id && msg.runId) {
        setRunning(false);
        api.listFlowRuns(p.flow.id).then(setRuns).catch(() => undefined);
        void loadRunTree(msg.runId);
      }
    });
  }, [p.flow, runId]);

  const renderedOutput = useMemo(() => {
    const text = events
      .filter((e) => e.type === "message_end")
      .map((e) => extractText((e as Extract<PiEvent, { type: "message_end" }>).message.content))
      .filter(Boolean)
      .join("\n\n");
    return text || "（等待输出）";
  }, [events]);

  async function loadRunTree(id: string): Promise<void> {
    if (!p.flow) return;
    setSelectedRunId(id);
    setSelectedFilePath(null);
    setFileContent("");
    const tree = await api.flowRunTree(p.flow.id, id);
    setRunTree(tree);
    const files = flattenFiles(tree);
    if (files[0]) {
      setSelectedFilePath(files[0].path);
      const f = await api.flowRunFileGet(p.flow.id, id, files[0].path);
      setFileContent(f.content);
    }
  }

  async function pickFile(path: string): Promise<void> {
    if (!p.flow || !selectedRunId) return;
    setSelectedFilePath(path);
    const f = await api.flowRunFileGet(p.flow.id, selectedRunId, path);
    setFileContent(f.content);
  }

  function startRun() {
    const chosen = defs.length > 0 ? JSON.stringify(values, null, 2) : prompt.trim();
    if (!chosen || !p.flow) return;
    const id = crypto.randomUUID();
    gateway.send({ type: "execute_flow", flowId: p.flow.id, runId: id, text: chosen, model: p.model || undefined });
  }

  if (!p.flow) return <Placeholder icon={Workflow} title="执行" hint="先在左侧选择一个工作流" />;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-[360px] shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-3 text-sm font-medium">{p.flow.name}</div>
        <select value={p.model} onChange={(e) => p.onModelChange(e.target.value)} className="mb-3 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700">
          {p.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>

        {defs.length > 0 ? (
          <div className="space-y-3">
            {defs.map((d) => (
              <label key={d.name} className="block text-xs">
                <div className="mb-1 font-medium">{d.name}{d.required ? " *" : ""}</div>
                {d.type === "enum" ? (
                  <select value={values[d.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [d.name]: e.target.value }))} className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700">
                    <option value="">请选择</option>
                    {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={values[d.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [d.name]: e.target.value }))} className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700" />
                )}
              </label>
            ))}
          </div>
        ) : (
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} placeholder="描述本次执行任务" className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700" />
        )}

        <button onClick={startRun} disabled={running} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-sm text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900">
          {running ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Play className="h-4 w-4" strokeWidth={1.75} />}
          {running ? "运行中..." : "开始运行"}
        </button>

        <div className="mt-6 text-xs text-neutral-500">运行历史</div>
        <div className="mt-2 max-h-[32vh] space-y-1 overflow-auto">
          {runs.map((r) => (
            <button key={r.id} onClick={() => void loadRunTree(r.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800", selectedRunId === r.id && "bg-neutral-100 dark:bg-neutral-800")}>
              {r.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : r.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <Loader2 className="h-3.5 w-3.5" />}
              <span className="truncate">{r.id.slice(0, 8)} · {new Date(r.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        <div className="w-1/2 border-r border-neutral-200 p-4 dark:border-neutral-800">
          <div className="mb-2 text-sm font-medium">实时输出</div>
          <pre className="h-[42%] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">{renderedOutput}</pre>
          <div className="mb-2 mt-4 text-sm font-medium">产出目录 {selectedRunId ? `(runs/${selectedRunId})` : ""}</div>
          <div className="h-[42%] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900">
            {runTree ? <TreeView node={runTree} onPick={(path) => void pickFile(path)} /> : <div className="p-2 text-xs text-neutral-500">暂无运行产出</div>}
          </div>
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-2 text-sm font-medium">文件预览 {selectedFilePath ? `· ${selectedFilePath}` : ""}</div>
          <pre className="h-[88%] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">{fileContent || "请选择左侧产出文件"}</pre>
        </div>
      </div>
    </div>
  );
}
