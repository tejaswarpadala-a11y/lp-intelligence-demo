"use client";

type ExportButtonProps = {
  rows: Record<string, string>[];
  filenameBase: string;
  className?: string;
};

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function ExportButton({ rows, filenameBase, className }: ExportButtonProps) {
  function download() {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((row) =>
        headers.map((h) => escapeCsvCell(row[h] ?? "")).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lp-${filenameBase}-profile.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className={
        className ??
        "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-slate-50"
      }
    >
      Export profile as CSV
    </button>
  );
}
