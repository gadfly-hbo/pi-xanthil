# px-hook-runner

pi-xanthil「计算工具 · hooks 管理」的声明式 hook 转发扩展（卡1/2 交付）。

## 它是什么

pi 的 hook = extension 事件订阅（`pi.on(event, handler)`）。本扩展是**一个通用转发器**：运行时读 `hooks.json`，对 pi 生命周期事件匹配用户在 UI 里定义的规则，执行动作并记录触发流水。用户**不需要写/编译 TS**，只在网页填表即可创建 hook。

## 加载方式

由 `server/src/pi-adapter.ts` 的 `runPiTurn` 以 `pi -e <此文件>` 注入，**仅作用于 pi-xanthil 触发的 pi 进程**（用户手动 `pi` 不加载）。pi 原生加载 `.ts`，**无需编译**。

## 环境变量（由 pi-adapter 注入）

- `PX_HOOKS_CONFIG` — `hooks.json` 路径（`Hook[]` 或 `{ hooks: Hook[] }`）。缺失视为无 hook。
- `PX_HOOKS_LOG` — `hooks-triggers.jsonl` 路径，每次触发 append 一行 `HookTriggerRecord`。

契约定义见 `server/src/types.ts` 与 `web/src/types.ts` 的 `Hook` / `HookTriggerRecord`。

## 数据安全（等同红线对待）

- 仅 `command`（本地 shell）+ `log` 两类动作；**不实现外发(HTTP)**。
- 仅观测/旁路：**绝不 block 工具调用、不改写消息**（MVP 不做拦截）。
- trigger 流水只记事件元数据 + 截断参数预览，**不落完整 message/tool 内容**。

命令动作运行时注入的环境变量：`HOOK_EVENT` / `HOOK_TOOL_NAME` / `HOOK_SESSION_ID` / `HOOK_ARGS_PREVIEW`。
