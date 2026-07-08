#!/usr/bin/env python3
"""服务端 DuckDB 聚合查询 ExtractionTool.

输入文件/目录物化为 input_data 内存表，执行只读 SELECT 聚合 SQL。
安全边界：
  - 本工具只做服务端独立 DuckDB，不复用前端数据探索 duckdb-wasm 实例。
  - 用户 SQL 执行前关闭 DuckDB external access，禁止 SQL 内部再读取任意文件/网络资源。
  - 明细行输出由工具说明 + SQL 校验 + /api/extraction-tools/:id/run 的 source=ai 行数闸口共同约束。
"""
import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import make_metric_snapshot, make_artifact_metadata


SUPPORTED_EXTS = {".csv", ".tsv", ".parquet", ".json", ".jsonl"}
FORBIDDEN_SQL_RE = re.compile(
    r"\b("
    r"attach|copy|create|delete|drop|export|insert|install|load|pragma|replace|set|"
    r"update|alter|vacuum|call|import|"
    r"read_csv|read_csv_auto|read_parquet|parquet_scan|read_json|read_json_auto|"
    r"read_text|read_blob|glob|sniff_csv"
    r")\b",
    re.IGNORECASE,
)


def jsonable(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def import_duckdb():
    try:
        import duckdb  # type: ignore
        return duckdb
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "缺少 Python duckdb 依赖；请先安装 server/tools/requirements.txt 中的 duckdb"
        ) from exc


def normalize_sql(sql):
    text = str(sql or "").strip()
    if not text:
        raise ValueError("sql required")
    without_tail = text[:-1].strip() if text.endswith(";") else text
    if ";" in without_tail:
        raise ValueError("仅允许单条 SELECT SQL")
    if not re.match(r"^\s*(with|select)\b", text, re.IGNORECASE):
        raise ValueError("仅允许 SELECT / WITH 查询")
    if FORBIDDEN_SQL_RE.search(text):
        raise ValueError("SQL 含禁止关键字；仅允许只读聚合查询")
    if re.search(r"\bselect\s+\*", text, re.IGNORECASE):
        raise ValueError("禁止 SELECT * 输出明细，请显式选择聚合字段")
    return text


def discover_files(input_path):
    if os.path.isfile(input_path):
        files = [input_path]
    elif os.path.isdir(input_path):
        files = [
            os.path.join(input_path, name)
            for name in sorted(os.listdir(input_path))
            if os.path.splitext(name)[1].lower() in SUPPORTED_EXTS
        ]
    else:
        raise ValueError(f"输入路径不存在: {input_path}")
    if not files:
        raise ValueError("未找到可查询文件（支持 .csv/.tsv/.parquet/.json/.jsonl）")
    for path in files:
        ext = os.path.splitext(path)[1].lower()
        if ext not in SUPPORTED_EXTS:
            raise ValueError(f"不支持的文件格式: {ext}")
    return files


def relation_sql_for_files(files):
    by_ext = {}
    for path in files:
        by_ext.setdefault(os.path.splitext(path)[1].lower(), []).append(path)
    parts = []
    for ext, paths in sorted(by_ext.items()):
        escaped = [p.replace("'", "''") for p in paths]
        path_literals = ["'" + p + "'" for p in escaped]
        path_arg = "[" + ", ".join(path_literals) + "]"
        if ext == ".parquet":
            fn = "read_parquet"
            args = path_arg
        elif ext == ".tsv":
            fn = "read_csv_auto"
            args = path_arg + ", delim='\\t', filename=true"
        elif ext == ".csv":
            fn = "read_csv_auto"
            args = path_arg + ", filename=true"
        elif ext in {".json", ".jsonl"}:
            fn = "read_json_auto"
            args = path_arg + ", filename=true"
        else:
            raise ValueError(f"不支持的文件格式: {ext}")
        parts.append(f"SELECT * FROM {fn}({args})")
    return "\nUNION ALL\n".join(parts)


def materialize_input_data(con, files):
    con.execute(f"CREATE TEMP TABLE input_data AS {relation_sql_for_files(files)}")


def disable_external_access(con):
    try:
        con.execute("SET enable_external_access=false")
    except Exception as exc:
        raise RuntimeError("DuckDB 无法关闭 external access，已拒绝执行用户 SQL") from exc


def write_outputs(output_path, result):
    os.makedirs(output_path, exist_ok=True)
    md_path = os.path.join(output_path, "duckdb_aggregate_report.md")
    json_path = os.path.join(output_path, "duckdb_aggregate_report.json")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    lines = [
        "# DuckDB SQL 聚合查询结果",
        "",
        f"- 结果行数: {result['rowCount']}",
        f"- 结果列数: {result['columnCount']}",
        f"- 输入文件数: {result['sourceFiles']}",
        "",
        "## SQL",
        "",
        "```sql",
        result["sql"],
        "```",
        "",
    ]
    if result["rows"]:
        columns = result["columns"]
        lines.append("## 结果预览")
        lines.append("")
        lines.append("| " + " | ".join(columns) + " |")
        lines.append("| " + " | ".join(["---"] * len(columns)) + " |")
        for row in result["rows"][:50]:
            lines.append("| " + " | ".join(str(row.get(col, "")) for col in columns) + " |")
    else:
        lines.append("（查询返回 0 行）")
    lines.append("")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return [md_path, json_path]


def run(input_path, output_path, sql):
    duckdb = import_duckdb()
    files = discover_files(input_path)
    safe_sql = normalize_sql(sql)
    con = duckdb.connect(database=":memory:")
    try:
        materialize_input_data(con, files)
        disable_external_access(con)
        cursor = con.execute(safe_sql)
        columns = [desc[0] for desc in cursor.description or []]
        raw_rows = cursor.fetchall()
        rows = [
            {columns[i]: jsonable(value) for i, value in enumerate(row)}
            for row in raw_rows
        ]
    finally:
        con.close()

    result = {
        "sql": safe_sql,
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "columnCount": len(columns),
        "sourceFiles": len(files),
    }
    return result


def format_md(result):
    lines = [
        "# DuckDB SQL 聚合查询结果",
        "",
        f"- 结果行数: {result.get('rowCount', 0)}",
        f"- 结果列数: {result.get('columnCount', 0)}",
        f"- 输入文件数: {result.get('sourceFiles', 0)}",
        "",
        "## SQL",
        "",
        "```sql",
        result.get("sql", ""),
        "```",
        "",
    ]
    rows = result.get("rows", [])
    if rows:
        columns = result.get("columns", [])
        lines.append("## 结果预览")
        lines.append("")
        lines.append("| " + " | ".join(columns) + " |")
        lines.append("| " + " | ".join(["---"] * len(columns)) + " |")
        for row in rows[:50]:
            lines.append("| " + " | ".join(str(row.get(col, "")) for col in columns) + " |")
    else:
        lines.append("（查询返回 0 行）")
    lines.append("")
    return "\n".join(lines)


def build_native_output(input_path, output_path, result):
    """为 duckdb-aggregate 构造标准 ToolRunOutput；保留对多文件/多扩展名的完整支持。"""
    source_file = os.path.basename(input_path) if os.path.isfile(input_path) else os.path.basename(os.path.normpath(input_path))
    period = ""
    md_path, json_path = write_outputs(output_path, result)
    artifacts = [
        make_artifact_metadata(md_path, output_path, "report"),
        make_artifact_metadata(json_path, output_path, "data"),
    ]
    return {
        "status": "success",
        "summary": f"DuckDB 聚合查询完成：{result['rowCount']} 行 × {result['columnCount']} 列，输入 {result['sourceFiles']} 个文件。",
        "metrics": [
            make_metric_snapshot("结果行数", result["rowCount"], "duckdb-aggregate", "rowCount", source_file, period, "行"),
            make_metric_snapshot("结果列数", result["columnCount"], "duckdb-aggregate", "columnCount", source_file, period),
            make_metric_snapshot("输入文件数", result["sourceFiles"], "duckdb-aggregate", "sourceFiles", source_file, period),
        ],
        "artifacts": artifacts,
        "rowGuard": {"blocked": False},
    }


def main():
    parser = argparse.ArgumentParser(description="DuckDB SQL 聚合查询")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    parser.add_argument("--param-sql", required=True)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    try:
        result = run(input_path, output_path, args.param_sql)
        summary = build_native_output(input_path, output_path, result)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[OK] DuckDB SQL 聚合查询: status={summary['status']}, rowCount={result['rowCount']}")
    except Exception as exc:
        summary = {
            "status": "failed",
            "summary": str(exc),
            "metrics": [],
            "artifacts": [],
            "rowGuard": {"blocked": False},
            "errorCode": "tool_error",
        }
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
