"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, ExternalLink, FileSpreadsheet, History, Link2, Loader2, Plus,
  RefreshCw, Rocket, Trash2, Upload, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import {
  HANDOVER_CHECKLIST, LC_FUNCTIONS_FOR_HANDOVER, type Handover, type LcPeriodKind,
} from "@/lib/lc-term";
import type { LcOverview } from "@/server/lc-term";
import {
  linkPlanningSheet, mirrorMembershipNow, saveHandover, setHandoverChecklistItem,
  setMembershipSource, startLcPeriod, uploadPlanningWorkbook,
} from "@/server/lc-actions";
import { MembershipUploadDialog } from "./membership-upload-dialog";

/**
 * SETTINGS → LC (v37.2) — the LCP's and the admins' tools for moving the LC
 * from one peak or term to the next, laid out as the order they are done in:
 *
 *   1. what is starting — a new PEAK (membership restarts, planning stays)
 *      or a new TERM (both restart)
 *   2. the planning — link the term's sheet, or upload the workbook when it
 *      exists (term only; "later" is allowed and reminded)
 *   3. the membership — upload the new list; whoever isn't on it goes inactive
 *   4. the handover — what the incoming EB must know, per function, and links
 *   5. start — stamps the period, resets the checklist, tells the EB
 *
 * Plus the standing settings: where membership lives, and the checklist.
 */
export function LcSettingsSection({ lc }: { lc: LcOverview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<LcPeriodKind>("peak");
  const [planningLater, setPlanningLater] = useState(false);
  const [sheetInput, setSheetInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, ok: string) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast.success(r.message ?? ok);
          router.refresh();
        } else toast.error(r.error ?? "That didn't work.");
      } catch {
        toast.error("That didn't work — try again.");
      }
    });

  const readWorkbook = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const tabs: Record<string, unknown[][]> = {};
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
        tabs[name] = rows.slice(0, 120).map((r) => (r as unknown[]).slice(0, 60));
      }
      run(async () => {
        const r = await uploadPlanningWorkbook(tabs);
        return r.ok
          ? { ok: true, message: `Planning imported — ${r.data?.cells ?? 0} plan cells.` }
          : r;
      }, "Planning imported.");
    } catch {
      toast.error("That file couldn't be read — upload the planning tool as .xlsx.");
    }
  };

  const state = lc.state;
  const doneCount = (termOnly: boolean) =>
    HANDOVER_CHECKLIST.filter((c) => !c.termOnly || termOnly).filter((c) => state?.checklist?.[c.id]).length;

  return (
    <div className="space-y-4">
      {/* ---------------- where the LC stands ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Where the LC stands</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Term (by the calendar)" value={lc.currentTermLabel} />
          <Fact label="Peak (by the calendar)" value={lc.currentPeakLabel} />
          <Fact
            label="Last started in Sodio"
            value={state ? `${state.kind === "term" ? "Term" : "Peak"} · ${fmtDateTime(state.startedAt)}` : "Never"}
            hint={state ? `by ${state.startedBy}` : undefined}
          />
          <Fact label="Members" value={`${lc.members.active} active`} hint={`${lc.members.inactive} inactive`} />
        </CardContent>
      </Card>

      {state?.planningPending ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Term {state.termLabel} started without its planning — link the planning sheet or upload the workbook below
          when it&apos;s ready.
        </p>
      ) : null}

      {/* ---------------- 1. what's starting ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4 text-primary" /> Start a new peak or term
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Work down the steps. Each one runs on its own button, so you can do them in any order,
            check the result, and come back — step 5 records that the LC has moved on.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <Step n={1} title="What is starting?">
            <div className="grid gap-2 sm:grid-cols-2">
              {(["peak", "term"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition",
                    kind === k ? "border-primary bg-primary/5" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">{k === "peak" ? "A new peak" : "A new term"}</p>
                  <p className="text-xs text-muted-foreground">
                    {k === "peak"
                      ? "Six months in: the membership restarts. The planning stays — it belongs to the term."
                      : "February: a new planning sheet AND a new membership."}
                  </p>
                </button>
              ))}
            </div>
          </Step>

          {kind === "term" ? (
            <Step n={2} title="The term's planning">
              <p className="text-xs text-muted-foreground">
                Now:{" "}
                {lc.planning.sheetUrl ? (
                  <a href={lc.planning.sheetUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    the linked planning sheet <ExternalLink className="inline size-3" />
                  </a>
                ) : (
                  "no planning sheet linked"
                )}
                {" · "}
                {lc.planning.cellsThisTerm > 0
                  ? `${lc.planning.cellsThisTerm} plan cells for term ${lc.currentTermLabel}`
                  : `nothing imported for term ${lc.currentTermLabel} yet`}
                {lc.planning.lastImportAt ? ` · last import ${fmtDateTime(lc.planning.lastImportAt)}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="Paste the planning sheet's link"
                  className="h-9 min-w-56 flex-1"
                />
                <Button
                  disabled={pending || !sheetInput.trim()}
                  onClick={() =>
                    run(async () => {
                      const r = await linkPlanningSheet(sheetInput);
                      return r.ok ? { ok: true, message: `Linked and imported — ${r.data?.cells ?? 0} plan cells.` } : r;
                    }, "Planning linked.")
                  }
                >
                  <Link2 className="size-4" /> Link &amp; import
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">or</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 hover:bg-muted">
                  <FileSpreadsheet className="size-4" /> Upload the planning workbook (.xlsx)
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void readWorkbook(f);
                    }}
                  />
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={planningLater} onChange={(e) => setPlanningLater(e.target.checked)} />
                  It isn&apos;t ready — I&apos;ll add it later (Sodio will remind you here)
                </label>
              </div>
            </Step>
          ) : (
            <Step n={2} title="The planning">
              <p className="text-sm text-muted-foreground">
                Stays as it is — a new peak continues the term&apos;s planning
                {lc.planning.cellsThisTerm > 0 ? ` (${lc.planning.cellsThisTerm} plan cells for ${lc.currentTermLabel})` : ""}.
              </p>
            </Step>
          )}

          <Step n={3} title="The membership">
            <p className="text-sm text-muted-foreground">
              Download the current list, keep who stays, add who joins, and upload it with
              <b> Restart</b>: whoever isn&apos;t on it is marked inactive. Their accounts, calls and
              history stay theirs, and it is reversible.
            </p>
            <Button variant="outline" onClick={() => setUploading(true)}>
              <Users className="size-4" /> Restart the membership from a file
            </Button>
            <MembershipUploadDialog
              open={uploading}
              onClose={() => {
                setUploading(false);
                router.refresh();
              }}
              canRestart
              defaultMode="restart"
            />
          </Step>

          <Step n={4} title="The handover">
            <HandoverEditor initial={lc.handover} />
          </Step>

          <Step n={5} title="Start it">
            <p className="text-sm text-muted-foreground">
              Records the new {kind} (keeping the last one in the history), clears the checklist below,
              and sends the EB a notification to read the handover.
            </p>
            {confirmStart ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={pending}
                  onClick={() => {
                    setConfirmStart(false);
                    run(() => startLcPeriod(kind, { planningLater }), "Started.");
                  }}
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                  Yes, start the new {kind}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmStart(false)}>No</Button>
              </div>
            ) : (
              <Button onClick={() => setConfirmStart(true)} disabled={pending}>
                <Rocket className="size-4" /> Start the new {kind}
              </Button>
            )}
          </Step>
        </CardContent>
      </Card>

      {/* ---------------- the checklist ---------------- */}
      {state ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              Handover checklist
              <Badge variant="outline">
                {doneCount(state.kind === "term")} / {HANDOVER_CHECKLIST.filter((c) => !c.termOnly || state.kind === "term").length}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              What Sodio can&apos;t do for you. Ticked here, so the next LCP sees what was done.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {HANDOVER_CHECKLIST.filter((c) => !c.termOnly || state.kind === "term").map((c) => {
              const done = !!state.checklist?.[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setHandoverChecklistItem(c.id, !done), done ? "Unticked." : "Done.")}
                  className="flex items-start gap-2 rounded-lg border p-2.5 text-left transition hover:bg-muted/50"
                >
                  {done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    <span className={cn("text-sm font-medium", done && "line-through opacity-70")}>{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- where membership lives ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Where membership lives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["sodio", "sheet"] as const).map((src) => (
              <button
                key={src}
                type="button"
                disabled={pending}
                onClick={() =>
                  src !== lc.membershipSource &&
                  run(() => setMembershipSource(src), src === "sodio" ? "Sodio is the membership now." : "Back to two-way with the sheet.")
                }
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  lc.membershipSource === src ? "border-primary bg-primary/5" : "hover:bg-muted"
                )}
              >
                <p className="text-sm font-semibold">
                  {src === "sodio" ? "In Sodio (the sheet mirrors it)" : "In the Google Sheet (two-way)"}
                  {lc.membershipSource === src ? <Badge className="ml-2" variant="secondary">now</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {src === "sodio"
                    ? "Edit, upload and download membership in Sodio. The sheet is rewritten from Sodio; edits made in the sheet are not read back."
                    : "The old way: the sheet is read every 30 minutes and wins. Use only if the LC edits membership in the sheet again."}
                </p>
              </button>
            ))}
          </div>
          {lc.membershipSource === "sodio" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await mirrorMembershipNow();
                  return r.ok ? { ok: true, message: `The sheet now mirrors ${r.data?.rows ?? 0} people.` } : r;
                }, "Mirrored.")
              }
            >
              <RefreshCw className="size-4" /> Rewrite the sheet from Sodio now
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {lc.history.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" /> Earlier starts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {lc.history.map((h) => (
                <li key={h.startedAt} className="text-muted-foreground">
                  <span className="font-medium text-foreground">{h.kind === "term" ? `Term ${h.termLabel}` : h.peakLabel}</span>
                  {" · "}
                  {fmtDateTime(h.startedAt)} by {h.startedBy}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-bold" title={value}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[2rem_1fr]">
      <span className="hidden size-7 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary sm:flex">
        {n}
      </span>
      <div className="grid min-w-0 gap-2">
        <p className="font-semibold">
          <span className="text-primary sm:hidden">{n}. </span>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

/** The handover: a note for everyone, one per function, and the links. */
function HandoverEditor({ initial }: { initial: Handover }) {
  const router = useRouter();
  const [general, setGeneral] = useState(initial.general);
  const [per, setPer] = useState<Record<string, string>>(initial.perFunction);
  const [links, setLinks] = useState(initial.links.length ? initial.links : [{ label: "", url: "" }]);
  const [fnOpen, setFnOpen] = useState<string>(Object.keys(initial.perFunction)[0] ?? "IGV");
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      try {
        const r = await saveHandover({ general, perFunction: per, links: links.filter((l) => l.label && l.url) });
        if (r.ok) {
          toast.success("Handover saved — the EB reads it under Settings → Handover.");
          router.refresh();
        } else toast.error(r.error);
      } catch {
        toast.error("Couldn't save — try again.");
      }
    });

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label>For the whole incoming EB</Label>
        <Textarea
          dir="auto"
          rows={4}
          value={general}
          onChange={(e) => setGeneral(e.target.value)}
          placeholder="What must they know first? What's mid-way, what's due, who to ask…"
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Per function</Label>
        <div className="flex flex-wrap gap-1">
          {LC_FUNCTIONS_FOR_HANDOVER.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFnOpen(f)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                fnOpen === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                per[f]?.trim() && fnOpen !== f && "border-primary/60"
              )}
            >
              {f}
              {per[f]?.trim() ? " ✓" : ""}
            </button>
          ))}
        </div>
        <Textarea
          dir="auto"
          rows={4}
          value={per[fnOpen] ?? ""}
          onChange={(e) => setPer((p) => ({ ...p, [fnOpen]: e.target.value }))}
          placeholder={`What the next ${fnOpen} VP inherits: open deals, partners, crew, what worked…`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Links they&apos;ll need</Label>
        {links.map((l, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Input
              value={l.label}
              onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder="What it is"
              className="h-9 w-40"
            />
            <Input
              value={l.url}
              onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              placeholder="https://…"
              className="h-9 min-w-48 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => setLinks((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ label: "", url: "" }]))}
              aria-label="Remove link"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}>
          <Plus className="size-4" /> Add a link
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Save the handover
        </Button>
        {initial.updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Last saved {fmtDateTime(initial.updatedAt)}{initial.updatedBy ? ` by ${initial.updatedBy}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}
