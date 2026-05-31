# 湘鉴 · pi-Xanthil

数据分析 AI 工作台 —— 基于 `pi` cli 的 Web 套壳，借鉴 PilotDeck 的 WorkSpace + 多面板生产力布局，技术栈自建（MIT 友好，不依赖 AGPL 代码）。

## 架构

```
浏览器  React18 + Vite7 + Tailwind3.4 + Radix(shadcn 模式)
  │  WS(任务流) + HTTP(REST)
Node Gateway/BFF  Express + ws + node:sqlite
  │  每轮 spawn: pi -p --mode json --session-id <id> --session-dir <ws>
pi cli (0.77+)  ←→  WorkSpace 文件系统（每项目隔离）
```

- **每轮 spawn + `--session-id`**：服务端无状态，会话连续性由 pi 自身持久化。
- **`node:sqlite`**（Node 22+ 内置）：零原生依赖，存 workspace / session / message 元数据。
- 数据落在 `~/.pi-xanthil/`（可用 `XANTHIL_DATA_DIR` 覆盖）。

## 运行

```bash
npm install          # 安装 root + server + web 三个 workspace
npm run dev          # 同时起 gateway(:8787) 和 web(:5173)
```

打开 http://localhost:5173 。

环境变量：`XANTHIL_PORT`(默认 8787)、`XANTHIL_PI_BIN`(默认 `pi`)、`XANTHIL_DATA_DIR`。

## 已完成 (Phase 0–1)

三栏布局 / 工作区·会话管理 / 对话发送 → pi JSON 事件流 → Markdown 渲染 / token·成本统计 / SQLite 历史持久化。

## 待办 (Phase 2+)

- 右侧预览：ECharts 图表 + TanStack 数据网格 + SheetJS Excel 预览 + PPTX/DOCX
- 数据文件拖拽上传 (react-dropzone + multer)
- 记忆 / 技能管理页（gray-matter frontmatter）
- xterm 原始终端视图、web-push 后台通知、i18next 多语言
- 流式增量渲染：观察成功对话时 pi 的 content delta 事件名后接入（当前按 `message_end` 整段渲染）

## 注意

- 本机 pi 的 `ptk-memory-inject` 扩展存在 better-sqlite3 版本不匹配报错，默认模型 `volcengine-plan/deepseek-v4-flash` 报 `developer` role 400 —— 跑真实对话前需在 pi 侧修复或在顶栏切换模型。
