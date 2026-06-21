import type { ReactNode } from "react";

export interface SummaryColumn<Row> {
  key: string;
  label: ReactNode;
  render: (row: Row) => ReactNode;
  className?: string;
}

export function SummaryTable<Row>({ columns, rows, rowKey, title, emptyText = "暂无汇总数据。" }: {
  columns: SummaryColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  title?: ReactNode;
  emptyText?: string;
}) {
  return <section className="mt-4 overflow-x-auto">
    {title && <div className="mb-2 text-sm font-semibold">{title}</div>}
    <table className="w-full text-left text-xs">
      <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
        <tr>{columns.map((column) => <th key={column.key} className={`py-2 pr-3 font-medium ${column.className ?? ""}`}>{column.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={rowKey(row)} className="border-b border-neutral-100 dark:border-neutral-900">
          {columns.map((column) => <td key={column.key} className={`py-2 pr-3 ${column.className ?? ""}`}>{column.render(row)}</td>)}
        </tr>)}
      </tbody>
    </table>
    {rows.length === 0 && <p className="py-3 text-xs text-neutral-400">{emptyText}</p>}
  </section>;
}
