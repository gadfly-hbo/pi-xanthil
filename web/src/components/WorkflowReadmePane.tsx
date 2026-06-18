import { ArrowDown, Bot, Wrench, TrafficCone, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";

// 重复模块操作说明（结合案例）。与 server/src/multi-agent-runner.ts（runner）、
// sql-loop-template.ts（SQL 修复 loop 预置模板）、docs/工作流-onblock契约.md（闭环口径）保持一致。
// 工作流 = 把一次分析固化成「可重复执行的多智能体节点图(DAG)」：每个节点是一个独立 AI 子任务或工具调用，
// 上游产出经黑板(blackboard)传给下游，门禁节点可拦截不合格的中间结果，失败还能带着原因自动回跳重试。

interface NodeKind {
  icon: typeof Bot;
  label: string;
  tone: string;
  what: string;
  example: string;
}

const NODE_KINDS: NodeKind[] = [
  {
    icon: Bot, label: "agent 节点", tone: "sky",
    what: "一次独立的 AI 子任务，跑在自己的 pi 会话里。prompt 用 {{占位符}} 引用上游节点产出或运行输入。",
    example: "「根据 {{plan}} 生成一条只读 SQL」——读上游 plan 节点的输出，产出 SQL。",
  },
  {
    icon: Wrench, label: "tool 节点", tone: "violet",
    what: "调一个确定性工具（如执行 SQL、清洗文件），不经 LLM。输入用 inputPath 模板，产物落 run 目录。",
    example: "run_sql 节点拿上游 SQL 去真实数据库执行，返回结构化结果（行数/字段/错误）。",
  },
  {
    icon: TrafficCone, label: "gate 节点（门禁）", tone: "amber",
    what: "对上游产出做一次审查并按固定阈值确定性判定 pass/blocked。blocked 会中断流程——AI 自己说“通过”不算数。",
    example: "sql_gate 检查 SQL 是否执行成功、结果非空、关键字段齐全；不达标亮红灯。",
  },
];

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { n: "1", title: "新建工作流", body: "在「工作视图」左侧列表点新建，得到一个空工作流（一个独立任务目录，自带 010_raw/020_clean/060_reports 标准目录）。" },
  { n: "2", title: "表单设计 or 手动编排", body: "三种方式：①「设计」里用表单把目标 / 输入 / 步骤 / gate / 回跳填清楚，AI 据此生成 workflow.json；已有 workflow 后还能用自然语言做局部「迭代修改」。② 直接打开 DAG 编辑器手动加节点、连边、配 prompt/模型/工具。③ 从预置模板一键实例化（见下）。" },
  { n: "3", title: "登记数据 / 配置", body: "在「聚合数据」登记本任务要用的 clean_data 文件（工作流执行时作为上下文注入；原始明细不进 LLM）。需要 SQL 的流程在「计算工具 → SQL连接」配连接。" },
  { n: "4", title: "运行", body: "在「工作视图」填一句任务诉求点运行。runner 按拓扑序逐节点执行，实时推送每个节点的开始/事件/结束与门禁裁决；产物落在本次 run 的目录下。" },
  { n: "5", title: "看产物 / run 历史 / 重跑", body: "右侧看每个节点的产出、specs 交付物、门禁裁决卡和完整 run 历史。可从任一节点「重跑」（继承上游产物，新建一次 run）。" },
];

interface CaseStep {
  icon: typeof Bot;
  kind: "agent" | "tool" | "gate";
  id: string;
  label: string;
  body: string;
}

const SQL_CASE: CaseStep[] = [
  { icon: Bot, kind: "agent", id: "plan", label: "plan · 分析计划", body: "根据任务和可用 schema 制定 SQL 分析计划：目标、要查的表/字段/口径、预期返回字段。" },
  { icon: Bot, kind: "agent", id: "sql", label: "sql · 生成 SQL", body: "按计划生成一条只读 SELECT。若带上一轮失败反馈 {{sql_error}}，只修复失败部分、不改业务口径。" },
  { icon: Wrench, kind: "tool", id: "run_sql", label: "run_sql · 执行 SQL", body: "拿 SQL 去真实连接执行（只读守卫 + 行数上限）。执行成败都返回结构化结果，交给门禁判定。" },
  { icon: TrafficCone, kind: "gate", id: "sql_gate", label: "sql_gate · 结果门禁", body: "确定性检查：执行码=0、结果非空、关键字段齐全。通过→继续；不通过→带错误原因回跳 sql 重试（最多 5 轮）。" },
];

function toneCls(tone: string): string {
  if (tone === "amber") return "border-amber-300 bg-amber-50/60 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-400";
  if (tone === "violet") return "border-violet-300 bg-violet-50/60 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/20 dark:text-violet-400";
  return "border-sky-300 bg-sky-50/60 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/20 dark:text-sky-400";
}

function caseTone(kind: string): string {
  if (kind === "gate") return "border-amber-300 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/20";
  if (kind === "tool") return "border-violet-200 bg-violet-50/50 dark:border-violet-800/50 dark:bg-violet-950/15";
  return "border-neutral-200 bg-neutral-50/60 dark:border-neutral-700 dark:bg-neutral-800/30";
}

export function WorkflowReadmePane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* intro */}
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">工作流是什么</h2>
        <p className="mt-2 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">
          工作流把一次分析<strong>固化成一张可重复执行的多智能体节点图（DAG）</strong>。和普通对话最大的不同：普通对话是一问一答、过程一次性；
          工作流把流程<strong>拆成多个独立节点</strong>，每个节点是一个 AI 子任务或工具调用，上游产出经<strong>黑板（blackboard）</strong>传给下游，
          关键处用<strong>门禁</strong>拦住不合格的中间结果，失败还能<strong>带着原因自动回跳重试</strong>。一次编排好，之后换个数据/诉求就能复跑。
        </p>

        {/* node kinds */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">三种节点</h3>
        <div className="mt-3 flex flex-col gap-2">
          {NODE_KINDS.map((nk) => {
            const Icon = nk.icon;
            return (
              <div key={nk.label} className={cn("rounded-md border px-3 py-2.5", toneCls(nk.tone))}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  <span className="text-[12.5px] font-semibold">{nk.label}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">{nk.what}</p>
                <p className="mt-1 text-[11px] leading-5 text-neutral-500 dark:text-neutral-500">例：{nk.example}</p>
              </div>
            );
          })}
        </div>

        {/* steps */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">怎么用（5 步）</h3>
        <div className="mt-3 flex flex-col gap-2">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3 rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">{s.n}</span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">{s.title}</div>
                <p className="mt-0.5 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* onBlock closed loop */}
        <h3 className="mt-8 flex items-center gap-2 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
          <RefreshCw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
          闭环：门禁失败自动回跳重试（onBlock）
        </h3>
        <p className="mt-2 text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300">
          给门禁节点配上 <strong>onBlock</strong> 后，它从“失败就停”升级为“失败就修”：门禁 blocked 时，系统把<strong>失败原因写进反馈变量</strong>回注给上游节点，
          游标<strong>回跳到指定上游</strong>重跑，循环直到通过或达到 <strong>最大轮数</strong>。配置项：
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-[12px] text-neutral-600 dark:text-neutral-300">
          <li>· <code className="font-mono text-[11px]">retryFromNodeId</code>：回跳到哪个上游节点（只能选门禁之前的节点）</li>
          <li>· <code className="font-mono text-[11px]">maxIterations</code>：loop 体最大执行轮数（含首轮，默认 3）</li>
          <li>· <code className="font-mono text-[11px]">feedbackVar</code>：失败原因写进哪个变量，上游 prompt 用 {`{{该变量}}`} 读取</li>
        </ul>
        <div className="mt-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/50 px-3 py-2 text-[11.5px] leading-5 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          <span><strong>红线不进重试环</strong>：命中数据安全红线的 blocked 直接硬停，不回跳；预算超限（token/成本上限）同样硬停。只有“质量没达标”这类软失败才会被重试。</span>
        </div>

        {/* case */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">案例：SQL 修复 loop</h3>
        <p className="mt-2 text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300">
          内置的「SQL 修复 loop」模板把上面的闭环用在最常见的场景——<strong>AI 写的 SQL 第一次往往跑不对</strong>。
          流程让门禁确定性地判断 SQL 结果好不好，不好就把错误反馈回去让 AI 只改错的部分，自动迭代到能跑通：
        </p>
        <div className="mt-3 flex flex-col items-stretch gap-0">
          {SQL_CASE.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.id}>
                <div className={cn("flex items-center gap-3 rounded-md border px-3 py-2.5", caseTone(s.kind))}>
                  <Icon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[11.5px] font-medium text-neutral-900 dark:text-neutral-100">{s.label}</span>
                    <p className="mt-0.5 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">{s.body}</p>
                  </div>
                </div>
                {i < SQL_CASE.length - 1 && (
                  <div className="flex justify-start py-0.5 pl-[26px]">
                    <ArrowDown className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
                  </div>
                )}
              </div>
            );
          })}
          {/* loop-back hint */}
          <div className="mt-1 flex items-center gap-2 pl-[26px] text-[11px] text-amber-600 dark:text-amber-400">
            <RefreshCw className="h-3 w-3" strokeWidth={2.5} />
            <span>门禁不通过 → 带 sql_error 回跳到 <strong>sql</strong> 节点重写，最多 5 轮，到点仍不过则停下交人工。</span>
          </div>
        </div>

        {/* templates */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">预置模板</h3>
        <div className="mt-3 flex flex-col gap-2">
          <div className="rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
            <div className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">AnaX 商业分析</div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">
              8 阶段商业分析方法论（BADIR + 执行验证 + 归档），带数据质量门禁和两阶段复核门禁。在「实验室 → AnaX」实例化，详见 AnaX 的 readme。
            </p>
          </div>
          <div className="rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
            <div className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">SQL 修复 loop</div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">
              上面案例的可运行模板（plan → sql → run_sql → sql_gate，门禁带 onBlock 回跳）。需要先在「SQL连接」配好数据库连接。
            </p>
          </div>
        </div>

        <p className="mt-8 text-[11.5px] leading-5 text-neutral-400">
          提示：工作流适合“多步骤、有明确验证标准、需要重复跑”的分析；一次性的日常问题用普通「数据分析」对话更轻。门禁拦下不是出错，而是流程在保护结果质量。
        </p>
      </div>
    </div>
  );
}
