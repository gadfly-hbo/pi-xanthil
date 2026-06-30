# server/tools — Python 工具运行环境

本目录下的工具（`tool.json` 中 `runtime: "python3"`）由 `/api/extraction-tools/:id/run` 网关
直接 `python3 <entry>` 调起，**复用宿主机的 system Python**，
不打包虚拟环境。所以新机器/新部署/换环境前必须装好下列依赖，否则 `/run` 会以 ImportError
失败（summary.json 里通常会带 `ModuleNotFoundError`）。

## 依赖安装

```bash
# Python >= 3.9
pip install -r server/tools/requirements.txt
```

依赖清单见 `requirements.txt`，覆盖：

| 工具 | 依赖 |
|---|---|
| apparel-structure | pandas, numpy |
| churn-risk | pandas, numpy |
| clv-prediction | pandas, numpy, scipy |
| cohort-retention | pandas, numpy |
| market-basket | pandas, numpy |
| rfm-segmentation | pandas, numpy |
| seasonal-forecast | pandas, numpy, **statsmodels**（STL + Holt-Winters，函数体 lazy import，无兜底分支） |
| phone-cleaner | pandas, openpyxl (.xlsx), xlrd (.xls) |
| extract-sycm-member | beautifulsoup4 (parser=`html.parser`，无需 lxml) |
| extract-tmall-profile | 无第三方依赖（仅标准库） |
| extract-xhs-insight | 无第三方依赖（仅标准库） |
| aarrr-flow / clustering | 当前仅 tests/ 占位，无 .py 入口（保留位） |

## 校验

装完后跑一遍 import 自检：

```bash
python3 -c "import pandas, numpy, scipy, statsmodels, bs4, openpyxl, xlrd; print('ok')"
```

各工具的最小验收 = 跑各自 `tests/` 下的单测 / 样例数据；缺依赖时 `/run` 返回的
`summary.json` 会包含 stderr 中的 `ModuleNotFoundError`，按提示 `pip install` 即可。

## 工具注册 SOP

新增或修改 `server/tools/<id>/tool.json` 时必须维护这些治理字段：

- `category`: `analysis` 才能进入 AI/MCP 候选；摄取原始/半结构化文件的工具用 `ingestion`。
- `tags`: 搜索和治理标签，不是权限。Python 数据分析工具至少包含 `python-analysis`，并建议补充业务域、分析任务、算法/模型标签，例如 `membership`、`retention`、`rfm`。
- `riskLevel`: 标注 L0-L3 风险层级。
- `allowedUse` / `forbiddenUse`: 明确允许和禁止用途，尤其要说明是否只能处理 `clean_data` 聚合数据。
- `failureHandling`: 写清失败时的用户提示或降级方式。

权限仍由 `category`、调用来源和 `/api/extraction-tools/:id/run` 网关策略决定；不要把 `tags` 当安全边界。

## 不做什么

- 不打包 venv；运行时绑定宿主机 Python。
- 不引入 lxml（`html.parser` 已够用）。
- 不在工具内部 hard-import 可选依赖；如需新增依赖，**同步更新 `requirements.txt` 与本 README**。
