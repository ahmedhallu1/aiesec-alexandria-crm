"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { safeFileName, safeSheetName, toCsv, type ExportBook } from "@/lib/export/book";

/**
 * EXPORT — one button, on every list and dashboard (v37.2).
 *
 * The server builds the rows (through the page's own scoped reader, with the
 * page's own filters — see `src/server/exports.ts`); this turns them into a
 * file in the browser. Excel carries every sheet; CSV is one sheet per file,
 * so a multi-sheet export offers one CSV per sheet.
 *
 * `params` is the page's own query string, so the file matches the screen.
 */
export function ExportButton({
  kind,
  params,
  label = "Export",
  sheetsHint,
  className,
  size = "sm",
}: {
  kind: string;
  /** the page's current URL params (filters); `kind` is added here */
  params?: string | URLSearchParams | Record<string, string | null | undefined>;
  label?: string;
  /** sheet names offered for CSV before the export has run (optional) */
  sheetsHint?: string[];
  className?: string;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const query = () => {
    const q = new URLSearchParams(
      typeof params === "string" || params instanceof URLSearchParams
        ? params
        : Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null && v !== "")) as Record<string, string>
    );
    // page-only params never reach the export
    q.delete("page");
    q.delete("size");
    q.set("kind", kind);
    return q.toString();
  };

  const fetchBook = async (): Promise<ExportBook | null> => {
    const res = await fetch(`/api/export?${query()}`, { cache: "no-store" });
    if (!res.ok) {
      const msg = await res.json().catch(() => null);
      toast.error(msg?.error ?? "The export failed — try again.");
      return null;
    }
    return (await res.json()) as ExportBook;
  };

  const save = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  };

  const run = async (format: "xlsx" | "csv", sheetName?: string) => {
    const key = `${format}:${sheetName ?? ""}`;
    setBusy(key);
    try {
      const book = await fetchBook();
      if (!book) return;
      const total = book.sheets.reduce((n, s) => n + s.rows.length, 0);
      if (book.sheets.length === 0 || total === 0) {
        toast.message("Nothing to export — the list is empty with these filters.");
        return;
      }
      const base = safeFileName(book.fileName);
      if (format === "csv") {
        // picked BY NAME — a sheet that only some viewers get (a TL's "My
        // team") must not shift which CSV the others download
        const sheet = book.sheets.find((x) => x.name === sheetName) ?? book.sheets[0];
        const name = book.sheets.length > 1 ? `${base} - ${safeFileName(sheet.name)}.csv` : `${base}.csv`;
        save(new Blob([toCsv(sheet)], { type: "text/csv;charset=utf-8" }), name);
        toast.success(`${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"} exported.`);
        return;
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      for (const s of book.sheets) {
        const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows]);
        // readable column widths — the longest of the header and the first rows
        ws["!cols"] = s.columns.map((c, i) => ({
          wch: Math.min(
            48,
            Math.max(8, String(c).length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 1))
          ),
        }));
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name, used));
      }
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      save(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${base}.xlsx`
      );
      toast.success(`${total} row${total === 1 ? "" : "s"} exported.`);
    } catch {
      toast.error("The export failed — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className={cn("gap-1.5", className)} disabled={busy !== null}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          What you see, as a file
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run("xlsx")}>
          <FileSpreadsheet className="size-4" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(sheetsHint && sheetsHint.length > 1 ? sheetsHint : ["CSV (.csv)"]).map((name) => (
          <DropdownMenuItem key={name} onSelect={() => void run("csv", sheetsHint && sheetsHint.length > 1 ? name : undefined)}>
            <FileText className="size-4" />
            {sheetsHint && sheetsHint.length > 1 ? `CSV — ${name}` : name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
