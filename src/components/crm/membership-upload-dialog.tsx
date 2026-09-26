"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Upload, UserMinus, UserPlus, UserPen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { applyMembershipUpload, previewMembershipUpload } from "@/server/lc-actions";
import { ExportButton } from "./export-button";

type Preview = {
  headerProblem: string | null;
  lines: { line: number; name: string; email: string | null; action: "new" | "update" | "same" | "invalid"; changes: string[]; reason?: string }[];
  leaving: { name: string; email: string | null }[];
};

/**
 * MEMBERSHIP FROM A FILE (v37.2) — the way the LC edits membership now that
 * Sodio is its source. The file is the SAME shape as "Download membership"
 * (Name · Email · Phone · Role · Function · Sub Function · Manager · Active),
 * so the round trip is: download, edit in Excel, upload, review, apply.
 *
 *   Update  — adds new people and applies changes; nobody else is touched
 *   Restart — (LCP/admins, a new peak) the file IS the membership: anyone
 *             active who isn't on it is marked inactive (history kept)
 *
 * Nothing is written until the preview has been read and Apply is pressed.
 */
export function MembershipUploadDialog({
  open,
  onClose,
  canRestart,
  defaultMode = "update",
}: {
  open: boolean;
  onClose: () => void;
  canRestart: boolean;
  defaultMode?: "update" | "restart";
}) {
  const [mode, setMode] = useState<"update" | "restart">(canRestart ? defaultMode : "update");
  const [fileName, setFileName] = useState<string | null>(null);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [pending, start] = useTransition();

  const reset = () => {
    setFileName(null);
    setGrid(null);
    setPreview(null);
    setConfirmRestart(false);
  };

  const readFile = async (file: File) => {
    reset();
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
      const clean = rows
        .map((r) => r.map((c) => String(c ?? "")))
        .filter((r, i) => i === 0 || r.some((c) => c.trim()));
      setFileName(file.name);
      setGrid(clean);
      runPreview(clean, mode);
    } catch {
      toast.error("That file couldn't be read — use .xlsx or .csv.");
    }
  };

  const runPreview = (g: string[][], m: "update" | "restart") =>
    start(async () => {
      const r = await previewMembershipUpload(g, m);
      if (r.ok && r.data) setPreview(r.data as Preview);
      else if (!r.ok) {
        setPreview(null);
        toast.error(r.error);
      }
    });

  const apply = () =>
    start(async () => {
      if (!grid) return;
      const r = await applyMembershipUpload(grid, mode);
      if (r.ok) {
        toast.success(
          `Membership updated from ${fileName} — ${r.data?.rows ?? 0} people read` +
            (r.data?.deactivated ? `, ${r.data.deactivated} marked inactive.` : ".")
        );
        reset();
        onClose();
      } else toast.error(r.error);
    });

  const count = (a: Preview["lines"][number]["action"]) =>
    preview?.lines.filter((l) => l.action === a).length ?? 0;
  const changed = preview?.lines.filter((l) => l.action === "new" || l.action === "update") ?? [];
  const invalid = preview?.lines.filter((l) => l.action === "invalid") ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : (reset(), onClose()))}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload membership</DialogTitle>
          <DialogDescription>
            Start from the current list — download it, edit it in Excel, upload it back. Nothing
            changes until you review and press Apply.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton kind="membership" label="Download current membership" />
            <span className="text-xs text-muted-foreground">
              Columns: Name · Email · Phone · Role · Function · Sub Function · Manager · Active (Yes/No)
            </span>
          </div>

          {canRestart ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {(["update", "restart"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setConfirmRestart(false);
                    if (grid) runPreview(grid, m);
                  }}
                  className={cn(
                    "rounded-lg border p-3 text-left transition",
                    mode === m ? "border-primary bg-primary/5" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">
                    {m === "update" ? "Update" : "Restart (new peak)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m === "update"
                      ? "Add new people and apply changes. Nobody else is touched."
                      : "The file IS the membership: anyone active who isn't on it is marked inactive. Their history stays theirs."}
                  </p>
                </button>
              ))}
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm hover:bg-muted/50">
            <Upload className="size-4" />
            {fileName ? `${fileName} — pick another` : "Pick the file (.xlsx or .csv)"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void readFile(f);
              }}
            />
          </label>

          {pending && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading it against Sodio…
            </p>
          ) : null}

          {preview ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"><UserPlus className="size-3" />{count("new")} new</Badge>
                <Badge className="gap-1 bg-primary/15 text-primary"><UserPen className="size-3" />{count("update")} changed</Badge>
                <Badge variant="outline">{count("same")} unchanged</Badge>
                {invalid.length ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />{invalid.length} can&apos;t be read</Badge> : null}
                {mode === "restart" ? (
                  <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400"><UserMinus className="size-3" />{preview.leaving.length} will be marked inactive</Badge>
                ) : null}
              </div>

              {changed.length > 0 ? (
                <details open className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">New and changed</summary>
                  <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto text-sm">
                    {changed.map((l) => (
                      <li key={l.line} className="rounded bg-muted/40 px-2 py-1">
                        <span className="font-medium" dir="auto">{l.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {l.action === "new" ? "· new" : `· ${l.changes.join(" · ")}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {invalid.length > 0 ? (
                <details open className="rounded-lg border border-destructive/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-destructive">
                    Lines that will be skipped
                  </summary>
                  <ul className="mt-2 grid max-h-48 gap-1 overflow-y-auto text-sm">
                    {invalid.map((l) => (
                      <li key={l.line}>
                        <span className="text-xs text-muted-foreground">Line {l.line} · </span>
                        <span dir="auto">{l.name}</span> — <span className="text-xs">{l.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {mode === "restart" && preview.leaving.length > 0 ? (
                <details className="rounded-lg border border-amber-500/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Marked inactive ({preview.leaving.length})
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    They stop signing in and leave every list; their accounts, calls and history stay
                    attributed to them. Reversible from Membership or by their Team Leader.
                  </p>
                  <ul className="mt-2 grid max-h-48 gap-0.5 overflow-y-auto text-sm">
                    {preview.leaving.map((p) => (
                      <li key={`${p.name}-${p.email}`} dir="auto">
                        {p.name} <span className="text-xs text-muted-foreground">{p.email ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => (reset(), onClose())}>Cancel</Button>
          {mode === "restart" && preview && preview.leaving.length > 0 && !confirmRestart ? (
            <Button variant="destructive" disabled={pending} onClick={() => setConfirmRestart(true)}>
              Apply — {preview.leaving.length} become inactive
            </Button>
          ) : (
            <Button
              disabled={pending || !preview || count("new") + count("update") + (mode === "restart" ? preview.leaving.length : 0) === 0}
              onClick={apply}
              variant={confirmRestart ? "destructive" : "default"}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmRestart ? "Yes, apply the restart" : "Apply"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
