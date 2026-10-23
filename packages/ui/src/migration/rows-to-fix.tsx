"use client";

import { Download } from "lucide-react";

import { Button } from "../primitives/button";

export interface RowToFix {
  readonly location: string;
  readonly reason: string;
  readonly values?: Readonly<Record<string, string>>;
}

const byteOrderMark = "﻿";

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function rowsToFixCsv(rows: readonly RowToFix[]): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const column of Object.keys(row.values ?? {})) {
      if (!columns.includes(column)) columns.push(column);
    }
  }
  const header = [...columns, "reason"];
  const lines = rows.map((row) => [
    ...columns.map((column) => row.values?.[column] ?? ""),
    row.values ? row.reason : `${row.location}: ${row.reason}`,
  ]);
  return `${[header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function DownloadRowsToFix({ rows }: { rows: readonly RowToFix[] }) {
  if (rows.length === 0) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-11 self-start"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([byteOrderMark, rowsToFixCsv(rows)], { type: "text/csv;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "rows-to-fix.csv";
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download aria-hidden="true" className="size-4" strokeWidth={1.5} />
      Download rows to fix (CSV)
    </Button>
  );
}
