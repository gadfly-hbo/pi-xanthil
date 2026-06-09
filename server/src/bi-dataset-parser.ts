import * as XLSX from "xlsx";

/**
 * 解析 csv/tsv/xlsx/xls buffer → 表头列名 + 行对象数组。
 * 共享 util：BI datasets 上传（index.ts）与看板聚合数据源（routes/data.ts · P0-D）共用，
 * 避免各域重复造解析轮子。仅做结构化解析，不含字段类型推断（FieldKind 由前端 profiling 完成）。
 */
export function parseAggregationBuffer(
  buf: Buffer,
  filename: string,
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const lower = filename.toLowerCase();
  let wb: XLSX.WorkBook;
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    wb = XLSX.read(text, { type: "string" });
  } else {
    wb = XLSX.read(buf, { type: "buffer" });
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("workbook has no sheets");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("first sheet is empty");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
  if (aoa.length === 0) return { columns: [], rows: [] };
  const headerRow = (aoa[0] ?? []) as unknown[];
  const columns: string[] = headerRow.map((c, i) => {
    const v = c == null ? "" : String(c).trim();
    return v || `col_${i + 1}`;
  });
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = (aoa[i] ?? []) as unknown[];
    if (r.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    for (let j = 0; j < columns.length; j++) {
      const key = columns[j];
      if (key === undefined) continue;
      obj[key] = r[j] ?? null;
    }
    rows.push(obj);
  }
  return { columns, rows };
}
