import { useState } from "react";
import { ArrowLeft, Download, RefreshCw, Users, Activity, BarChart3, Upload, Database, FileSpreadsheet, Play, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// Mock data generation
const MOCK_MONTHS = ["2023-01", "2023-02", "2023-03", "2023-04", "2023-05", "2023-06", "2023-07", "2023-08", "2023-09", "2023-10", "2023-11", "2023-12"];

const generateRetentionData = () => {
  return MOCK_MONTHS.map((month) => {
    const base = Math.floor(Math.random() * 5000) + 5000;
    const rates = Array.from({ length: 12 }).map((_, i) => {
      const dropoff = Math.pow(0.85, i + 1) * (0.3 + Math.random() * 0.1);
      return dropoff;
    });
    return { month, base, rates };
  });
};

const generateRecallData = () => {
  return MOCK_MONTHS.map((month) => {
    const totalRecall = Math.floor(Math.random() * 3000) + 2000;
    const dist = Array.from({ length: 12 }).map((_, i) => {
      const weight = Math.pow(0.7, i) * (0.8 + Math.random() * 0.4);
      return weight;
    });
    const sumDist = dist.reduce((a, b) => a + b, 0);
    const recallDist = dist.map(w => Math.floor(totalRecall * (w / sumDist)));
    const sumRecall = recallDist.reduce((a, b) => a + b, 0);
    if (sumRecall !== totalRecall && recallDist.length > 0 && recallDist[0] !== undefined) {
      recallDist[0] += (totalRecall - sumRecall);
    }
    return { month, totalRecall, recallDist };
  });
};

interface OpModelDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  icon: LucideIcon;
}

const MODELS: OpModelDef[] = [
  { id: "member_operations", name: "会员运营看板", description: "洞察新老会员的留存与召回效能，展示首购复购率及老客回购分布", tags: ["留存分析", "会员资产", "回购率"], icon: Users },
  { id: "growth_funnel", name: "流量漏斗模型", description: "展示各渠道流量的转化节点，定位转化瓶颈（开发中）", tags: ["渠道归因", "转化率", "获客"], icon: BarChart3 },
  { id: "lvt_cac", name: "LTV/CAC 监测", description: "实时监控客户终身价值与获客成本比值（开发中）", tags: ["商业健康度", "ROI", "财务模型"], icon: Activity }
];

function DataSourceConfig({ onConnect, onUseDemo }: { onConnect: () => void, onUseDemo: () => void }) {
  const [activeTab, setActiveTab] = useState<"file" | "sql">("file");
  const [fileState, setFileState] = useState<"idle" | "mapping">("idle");

  return (
    <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
          <Database className="h-6 w-6" />
        </div>
        <h2 className="text-[20px] font-semibold text-neutral-900 dark:text-neutral-100">配置数据源</h2>
        <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
          接入用户交易流水明细，系统将自动清洗并计算留存、召回等指标。<br/>
          所需字段：<span className="font-mono text-neutral-700 dark:text-neutral-300">用户ID</span>、<span className="font-mono text-neutral-700 dark:text-neutral-300">交易时间</span>。
        </p>
      </div>

      <div className="mb-6 flex space-x-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          onClick={() => setActiveTab("file")}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-md py-2 text-[13px] font-medium transition-all",
            activeTab === "file" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          )}
        >
          <FileSpreadsheet className="h-4 w-4" /> 文件导入 (CSV/Excel)
        </button>
        <button
          onClick={() => setActiveTab("sql")}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-md py-2 text-[13px] font-medium transition-all",
            activeTab === "sql" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          )}
        >
          <Database className="h-4 w-4" /> SQL直连
        </button>
      </div>

      {activeTab === "file" && (
        <div className="space-y-6">
          {fileState === "idle" ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 px-6 py-12 transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-blue-500/50 dark:hover:bg-blue-900/10">
              <Upload className="mb-4 h-8 w-8 text-neutral-400" />
              <p className="text-[14px] font-medium text-neutral-700 dark:text-neutral-300">点击上传或拖拽文件到此处</p>
              <p className="mt-1 text-[12px] text-neutral-500">支持 .csv, .xlsx, 最大 50MB</p>
              <button onClick={() => setFileState("mapping")} className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                选择文件（模拟演示）
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
              <div className="mb-4 flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
                <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  <FileSpreadsheet className="h-4 w-4 text-blue-500" />
                  orders_export_2023.csv
                </div>
                <button onClick={() => setFileState("idle")} className="text-[12px] text-neutral-500 hover:text-neutral-700">重新上传</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">匹配「用户ID」字段</label>
                    <select className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                      <option>user_id</option>
                      <option>member_code</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">匹配「交易时间」字段</label>
                    <select className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                      <option>order_time</option>
                      <option>created_at</option>
                    </select>
                  </div>
                </div>
                <button onClick={onConnect} className="w-full flex items-center justify-center gap-2 rounded-md bg-neutral-900 py-2.5 text-[13px] font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                  <CheckCircle2 className="h-4 w-4" /> 确认映射并生成看板
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "sql" && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">选择数据库连接</label>
            <select className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
              <option>业务主库 (PostgreSQL)</option>
              <option>数据中台 (MySQL)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">输入提取流水 SQL</label>
            <div className="relative">
              <textarea 
                className="h-32 w-full rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] text-neutral-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-blue-500"
                defaultValue={"SELECT\n  user_id,\n  created_at as order_time\nFROM orders\nWHERE status = 'PAID'\n  AND created_at >= '2023-01-01';"}
              />
            </div>
          </div>
          <button onClick={onConnect} className="w-full flex items-center justify-center gap-2 rounded-md bg-neutral-900 py-2.5 text-[13px] font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
            <Play className="h-4 w-4" /> 运行查询并生成看板
          </button>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-4 border-t border-neutral-100 pt-6 dark:border-neutral-800">
        <button onClick={onUseDemo} className="text-[13px] text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400">
          跳过配置，查看 Demo 演示数据
        </button>
      </div>
    </div>
  );
}

function MemberOperationsDashboard({ onBack }: { onBack: () => void }) {
  const [viewState, setViewState] = useState<"config" | "dashboard">("config");
  const [retentionData, setRetentionData] = useState(generateRetentionData());
  const [recallData, setRecallData] = useState(generateRecallData());
  const [isDemo, setIsDemo] = useState(false);

  const handleRefresh = () => {
    setRetentionData(generateRetentionData());
    setRecallData(generateRecallData());
  };

  const handleConnect = () => {
    setIsDemo(false);
    setRetentionData(generateRetentionData());
    setRecallData(generateRecallData());
    setViewState("dashboard");
  };

  const handleUseDemo = () => {
    setIsDemo(true);
    setRetentionData(generateRetentionData());
    setRecallData(generateRecallData());
    setViewState("dashboard");
  };

  if (viewState === "config") {
    return (
      <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-950">
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <button onClick={onBack} className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">会员运营看板</h2>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <DataSourceConfig onConnect={handleConnect} onUseDemo={handleUseDemo} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <button onClick={() => setViewState("config")} className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="重新配置数据源">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">会员运营看板 {isDemo && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Demo 数据</span>}</h2>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>刷新数据</span>
          </button>
          <button className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white">
            <Download className="h-3.5 w-3.5" />
            <span>导出报告</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-50 p-5 dark:bg-neutral-950">
        <div className="mx-auto max-w-[1200px] space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">表1：新会员复购留存表</h3>
              <span className="text-[12px] text-neutral-500">展示首购新会员在未来12个月的复购情况</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50">
                  <tr>
                    <th className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">首购月份</th>
                    <th className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">首购人数</th>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <th key={i} className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">第 {i + 1} 个月</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {retentionData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-neutral-900 dark:text-neutral-200">{row.month}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-400">{row.base.toLocaleString()}</td>
                      {row.rates.map((rate, i) => {
                        let colorClass = "text-neutral-600 dark:text-neutral-400";
                        if (rate > 0.25) colorClass = "text-green-600 font-medium dark:text-green-400";
                        else if (rate < 0.1) colorClass = "text-neutral-400 dark:text-neutral-500";
                        return <td key={i} className={cn("whitespace-nowrap px-3 py-2", colorClass)}>{(rate * 100).toFixed(1)}%</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">表2：老会员回购召回表</h3>
              <span className="text-[12px] text-neutral-500">分布在12个月的老会员在当月的回购分布情况</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50">
                  <tr>
                    <th className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">回购月份</th>
                    <th className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">老客回购总数</th>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <th key={i} className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 font-medium text-neutral-500 dark:border-neutral-800">m-{i + 1} 留存</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {recallData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-neutral-900 dark:text-neutral-200">{row.month}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-400 font-medium">{row.totalRecall.toLocaleString()}</td>
                      {row.recallDist.map((count, i) => {
                        const pct = count / row.totalRecall;
                        return (
                          <td key={i} className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-400">
                            <div>{count.toLocaleString()}</div>
                            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{(pct * 100).toFixed(1)}%</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OperationalModelPane() {
  const [activeDef, setActiveDef] = useState<OpModelDef | null>(null);

  if (activeDef?.id === "member_operations") {
    return <MemberOperationsDashboard onBack={() => setActiveDef(null)} />;
  }

  if (activeDef) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-950">
         <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
            <activeDef.icon className="h-6 w-6 text-neutral-400" />
         </div>
         <h3 className="mb-2 text-[15px] font-medium text-neutral-900 dark:text-neutral-100">{activeDef.name}</h3>
         <p className="text-[13px] text-neutral-500 dark:text-neutral-400">该看板功能正在开发中，敬请期待</p>
         <button onClick={() => setActiveDef(null)} className="mt-6 rounded-md bg-white border border-neutral-200 px-4 py-2 text-[13px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800">
            返回列表
         </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-neutral-900 dark:text-neutral-100">选择运营模型</h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">查看日常业务运营数据指标监控和分析看板</p>
      </div>
      <div className="grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        {MODELS.map((def) => {
          const Icon = def.icon;
          return (
            <button
              key={def.id}
              onClick={() => setActiveDef(def)}
              className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm transition-all hover:border-neutral-400 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <Icon className="h-5 w-5 text-neutral-600 dark:text-neutral-300" strokeWidth={1.75} />
              </div>
              <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">{def.name}</div>
              <div className="mt-1 flex-1 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">{def.description}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {def.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
