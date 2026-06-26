import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MINIMAX_API_KEY } from "./config.ts";

/**
 * 【收集专题 · E-COLLECT1】知识库「收集」联网聊天的后端能力。
 *
 * prepareCollectCwd：仿 subagent-core 的「专属 cwd + .mcp.json」范式，给收集 session
 * 准备一个挂了 minimax web_search MCP 的工作目录。pi 会自动加载 cwd 下的 .mcp.json
 * （与 workspace 根的 xanthil-data-tools 注册同机制）。联网能力**只对收集 session 开放**，
 * 不污染日常/专题/重复等其它 session（守「隐私数据不走第三方」红线）。
 *
 * key 取自 config.MINIMAX_API_KEY（服务端 env XANTHIL_MINIMAX_API_KEY），绝不硬编码、不入库；
 * 无 key 时自动降级为「无联网的纯本地聊天」（写空 mcpServers + warn，不抛错）。
 */

const MINIMAX_API_HOST = "https://api.minimaxi.com";

/** 收集 session 的专属工作目录名（落在 workspaceRoot 下，应在 .gitignore 中）。 */
export const COLLECT_CWD_DIRNAME = ".collect-cwd";

/**
 * 建（幂等）收集 session 的专属 cwd，写入 minimax MCP 的 .mcp.json，返回该 cwd 绝对路径。
 * 同一 workspace 复用同一 .collect-cwd（多轮对话稳定）。
 * apiKey 默认取 config.MINIMAX_API_KEY（prod 路径）；显式传入仅供测试覆盖两个分支。
 */
export function prepareCollectCwd(workspaceRoot: string, apiKey: string = MINIMAX_API_KEY): string {
  const cwd = join(workspaceRoot, COLLECT_CWD_DIRNAME);
  mkdirSync(cwd, { recursive: true });

  const mcpServers: Record<string, unknown> = {};
  if (apiKey) {
    mcpServers.minimax = {
      command: "uvx",
      args: ["minimax-coding-plan-mcp", "-y"],
      env: {
        MINIMAX_API_KEY: apiKey,
        MINIMAX_API_HOST,
      },
    };
  } else {
    console.warn(
      "[collect] XANTHIL_MINIMAX_API_KEY 未设置；收集 session 将以无联网的纯本地聊天运行。",
    );
  }

  writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf8");
  return cwd;
}

/**
 * 收集 session 的角色 system prompt：引导优先联网检索、附来源、联网不可用时显式降级。
 * 由 index.ts handleSend 在 collectWeb 命中时 prepend 到常规 systemPrompt 之前。
 */
export const COLLECT_SYSTEM_PROMPT = `你是「收集」联网助手，专为数据分析师收集最新在线信息、分析方法论与行业动态。

工作方式：
- 凡涉及最新动态、方法论、外部事实或时效性信息，**必须先用 web_search 工具联网检索**，不要仅凭已有知识作答。
- web_search 返回为 organic JSON 数组（每项含 title / link / snippet / date）。请解析后综合多条结果作答。
- 回答末尾**必须附「来源」区**，逐条列出引用的 link 与其 date，便于用户核对时效与出处。
- 若同一问题检索结果时间跨度大，优先采信 date 更新的来源，并提示信息的时间点。

降级约定：
- 若 web_search 工具不可用（未配置或调用失败），降级为基于已有知识作答，并在开头**明确告知「当前未联网，以下为离线知识」**，不要假装已联网。`;
