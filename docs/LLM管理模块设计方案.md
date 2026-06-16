# 计算工具-LLM 接入管理模块设计方案

> **状态**：方案 · 已派发（2026-06-16）
> **来源**：本会话「把 llm_mgmt 占位做成 pi-agent 的 LLM 接入管理前端控制台」收敛设计。
> **一句话**：照 `HooksManagementPane` 同构范式，新建一个**直写 pi 全局真源**（`~/.pi/agent/{models.json,settings.json}`）的 LLM 管理面板——Provider 接入（baseUrl/api/apiKey/模型目录）+ 模型启用/默认 + 轻量连通性测试；apiKey 全程不回显，OAuth 留给 `pi auth`，用量看板入需求池。

---

## 0. 总览结论

- 入口占位早就位：`constants.ts` 的 `AGGREGATE_SUB_TABS` 已含 `{ id:'llm_mgmt', label:'LLM管理' }`，只需把 `DataTabs.tsx:69` 的 Placeholder 换成 `<LlmManagementPane/>`。
- 不造轮子：后端 CRUD 照抄 `routes/data.ts` 的 hooks 段；前端面板照抄 `HooksManagementPane.tsx`。
- **宪章纠正（关键）**：Orchestration §四 已把 `/api/llm*` 命名空间划给**总控 `routes/shared.ts`**（非 D 的 `data.ts`）。故后端路由 + `llm-config.ts` 真源读写模块归**总控**；前端面板归 **D**（在 D 的聚合 tab 下）。

## 1. pi-agent 的 LLM 接入真实结构（已脱敏核验）

| 层 | 文件 | 内容 | 控制台 |
|---|---|---|---|
| Provider 目录 | `~/.pi/agent/models.json` | `providers.<id> = { baseUrl?, api?:"openai-completions", apiKey?, models:[{id,name,input,contextWindow,maxTokens?,reasoning?,baseUrl?,api?}] }` | ✅ CRUD |
| OAuth 凭证 | `~/.pi/agent/auth.json`（0600） | `{ <id>: { type, access, refresh, expires, accountId } }`，含 oauth/api_key 两类 | ⚠️ 只读展示授权态 |
| 启用+默认 | `~/.pi/agent/settings.json` | `enabledModels[]`(格式 `provider/model`) + `defaultProvider` + `defaultModel` + 其余键 | ✅ 仅动这三键 |
| 驱动包 | settings.`packages[]` | provider 驱动 npm 包 | ❌ 不碰 |

**二态兼容**：provider 级带 baseUrl/api/apiKey（volcengine-plan）；或下放 model 级、provider 无 key（minimax-cn）。coerce 必须两态都认。

## 2. 现状基线（复用的存量）

| 现状 | 位置 | 意义 |
|---|---|---|
| `/api/llm*` 命名空间已预留总控 | `server/src/routes/shared.ts:9` 注释 | 后端落 shared.ts，归总控 |
| 读侧已有 | `index.ts:862` GET /api/models · `workflow-config.ts:20` listConfiguredModelIds | 写侧新增，不动读逻辑 |
| 同构面板范式 | `HooksManagementPane.tsx`(728L) · `routes/data.ts` hooks 段(444-631) | 前后端照抄 |
| coerce 范式 | `data.ts:456 coerceHook` + `asStr/asNum/asStrArr/asRecord`(199-206) | 直接复用 |
| 消费端 ModelSelect | `ChatPane`/`CreationPane`/multi-agent | 读 `/api/models`，写后需刷新 |
| TabContext 契约 | `web/src/tabs/types.ts`（总控） | 加 `refreshModels?()` 字段 |
| 入口占位 | `DataTabs.tsx:69` llm_mgmt Placeholder | 待替换 |

## 3. 产品方案

### 3.1 后端真源读写（总控 · routes/shared.ts + 新建 llm-config.ts）

**config.ts 新常量**（不进 `ensureDirs()`，pi 全局目录非本应用拥有）：
```ts
export const PI_AGENT_DIR = process.env.XANTHIL_PI_AGENT_DIR ?? join(homedir(),".pi","agent");
export const PI_MODELS_PATH = process.env.XANTHIL_PI_MODELS ?? join(PI_AGENT_DIR,"models.json");
export const PI_SETTINGS_PATH = process.env.XANTHIL_PI_SETTINGS ?? join(PI_AGENT_DIR,"settings.json");
export const PI_AUTH_PATH = process.env.XANTHIL_PI_AUTH ?? join(PI_AGENT_DIR,"auth.json");
```

**llm-config.ts 关键函数**
- `listProvidersView()`：投影 raw，**apiKey 一律剥成 `hasApiKey:boolean`，绝不出网**；合并 auth.json 的 `oauth` 标记。
- `coerceProviderInput(id,input,prevRaw)`：白名单 `api∈{"openai-completions"}`；baseUrl provider 级或全 model 级至少一处必填；models 每项 `id` 必填、`name` 缺省=id、数值 clamp、`input` 缺省 `["text"]`。**apiKey 保留语义**：空/缺省/哨兵 `"****"` → 从 prevRaw 取旧值；非空 → 覆盖。**未知字段**以 `prevRaw.providers[id]` 为基底浅展开透传。
- `writeSettings(patch)`：仅覆盖 `enabledModels/defaultProvider/defaultModel`，深拷贝原 doc 回写；其余键原样保留；enabledModels 校验形如 `provider/model`；default 软校验存在于 models.json，否则 400。
- `atomicWriteJson(path,obj)`：**temp + rename 原子写**；写 models.json 前 `statSync` 取旧 mode、写后 `chmodSync` 还原。
- `listAuthStatus()`：只投影 `{providerId,type,authorized:true}`，绝不返回 access/refresh/accountId。
- `testProvider(id,timeout=8000)`：取有效 baseUrl+api+key（provider 级优先回落 model 级），`api==="openai-completions"` → `GET {baseUrl}/models` + `Bearer`，`AbortController` 超时，返回 `{ok,status,latencyMs,message}`，**message 经 `.replaceAll(key,"****")` 脱敏**。

**路由（routes/shared.ts，try/catch→500，校验失败 400，沿用 localhost-only 注释）**
```
GET  /api/llm/providers          → listProvidersView()        (key masked)
PUT  /api/llm/providers          → coerce + atomicWrite + 回 view
POST /api/llm/providers/:id/test → testProvider               (超时, key 不回显)
GET  /api/llm/settings           → 只投影 {enabledModels,defaultProvider,defaultModel}
PUT  /api/llm/settings           → writeSettings + 回投影
GET  /api/llm/auth               → listAuthStatus()           (只读)
```

### 3.2 契约接缝（总控 · types.ts 双侧 + api/shared.ts + TabContext）

- `types.ts` 双侧加 `LlmApiKind / LlmModelEntry / LlmProviderView / LlmSettingsView / LlmAuthStatus / LlmTestResult`。
- `lib/api/shared.ts` 加 client：`listLlmProviders / saveLlmProviders / testLlmProvider / getLlmSettings / saveLlmSettings / listLlmAuth`。
- `tabs/types.ts` 的 TabContext 加 `refreshModels?()`；`App.tsx` 把 `api.listModels().then(setModels)` 抽成 `refreshModels` 并装配进 tabCtx。

### 3.3 前端面板（D · LlmManagementPane，仿 HooksManagementPane）

- 左列：Providers 列表（id + 模型数 + 状态点：hasApiKey 绿 / oauth 蓝「已授权」/ 无 key 灰）+ `新建 Provider` + `保存到 models.json`。
- 右列 Provider 表单：`id`（新建可编辑/已存只读）、`api` select、`baseUrl`、`apiKey`（`type=password`、占位 `已配置(****)`、value 恒空、留空保存=保留旧；OAuth 灰掉提示 `pi auth`）。
- Models 子表：每行 id/name/contextWindow/reasoning + **启用 checkbox**（改 enabledModels）+ **默认星标**（改 default）+ 增删 model。
- 底部：`[测试连通]`（转圈→ok/latency/脱敏 message）、`[保存]`。
- 两条独立 dirty/save 链：providers→`PUT /api/llm/providers`；settings(启用/默认)→`PUT /api/llm/settings`，保存成功后调 `refreshModels()` 让 ModelSelect 反映。

### 3.4 进阶 → 入需求池（产品代码零残留）

- **用量/成本看板**（复用 `ModelLabStats` / token 监控 / `~/.pi/agent/run-history.jsonl`）→ `docs/backlog/llm-usage-dashboard.md`。

## 4. 开发计划（派发三卡）

| 卡 | 归属 | 交付 | 落点 | 验收 |
|---|---|---|---|---|
| **接缝** | X·总控自做 | Llm* 契约 + config 常量 + api/shared client + refreshModels | `types.ts`双侧、`config.ts`、`lib/api/shared.ts`、`tabs/types.ts`、`App.tsx` | 双侧 typecheck/build 绿；类型/常量/client 就位 |
| **后端** | X·委派 E 代笔 | llm-config.ts + /api/llm/* 路由 | 新建 `llm-config.ts`、`routes/shared.ts` | server typecheck 绿；curl providers 无 key 明文；PUT 往返保 key/未知字段；settings 其余键不变 |
| **面板** | D·数据基座 | LlmManagementPane + 接线 | 新建 `LlmManagementPane.tsx`、`DataTabs.tsx:69` | web typecheck/build 绿；CRUD/启用/默认持久；apiKey 不回显、留空不清空；测试连通 |

依赖时序：**接缝**（契约先行）→ **后端**（依赖契约）/ **面板**（依赖契约+后端 client）。

## 5. 关键设计取舍

- **为何后端归总控 shared.ts 而非 D data.ts**：宪章 §四 `/api/llm*` 早划归 shared.ts；且写 pi 全局真源 + apiKey 属 infra 敏感，归总控（委派 E 代笔，口径本文写死）。
- **为何直写 pi 全局真源**：单一真源、改完 pi 立即认、零同步成本。代价是跳出 DATA_ROOT 沙盒——故所有写 atomic temp+rename、保留未知字段与原 mode。
- **为何 apiKey 三道脱敏**：出口 mask / PUT 哨兵保留旧值 / test 错误 replaceAll——本地单用户 localhost-only，但 key 仍不应回网/回显。
- **为何 OAuth 只读**：`auth.json` OAuth 凭证由 `pi auth` 流程管，控制台写之易破坏刷新链。
- **为何用量看板入池**：价值未验证、改动面大，按需求池机制保产品干净、方案不丢。
