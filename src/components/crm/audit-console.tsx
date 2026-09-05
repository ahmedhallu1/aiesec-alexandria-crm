"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, RotateCcw, ScrollText, Search } from "lucide-react";
import type { AuditEntry, AuditFilterOptions } from "@/server/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

/** THE ACTIVITY CONSOLE (v36).
 *
 *  What this replaces: /admin fetched the newest 80 audit rows and grepped
 *  them IN THE BROWSER. On a table of 14,000+ that is a search box that mostly
 *  lies — it cannot find anything older than the last 80 actions, and it says
 *  "Nothing matches" when the truth is "I never looked". A log you cannot
 *  search is not an audit trail, it is a recent-activity widget.
 *
 *  Everything here filters and pages in Postgres. The URL carries the state,
 *  so a filtered view is a link somebody can paste to a colleague — the same
 *  reason /help made its searches shareable in v33.36. */
export function AuditConsole({
  audit, total, page, pageSize, options, canUnmask,
}: {
  audit: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  options: AuditFilterOptions;
  /** ADMIN_EMAILS only — whether anonymous authors were resolved (v33.30) */
  canUnmask: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const go = (patch: Record<string, string | null>) =>
    start(() => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "__all") next.delete(k);
        else next.set(k, v);
      }
      // any filter change resets to the first page — otherwise you land on
      // page 7 of a result set that now has two pages and see nothing
      if (!("apage" in patch)) next.delete("apage");
      router.replace(`/admin?${next.toString()}`, { scroll: false });
    });

  const val = (k: string) => params.get(k) ?? "__all";
  const filtered =
    !!params.get("actor") || !!params.get("action") || !!params.get("entity") ||
    !!params.get("cat") || !!params.get("outcome") || !!params.get("q") ||
    !!params.get("afrom") || !!params.get("ato");

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  /** CSV of WHAT IS ON SCREEN, not of everything — the filters are the point.
   *  Built in the browser from rows already fetched: no second endpoint, and
   *  nothing leaves the page that was not already on it. */
  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = [
      "when", "actor", "acting_as", "action", "entity", "category",
      "outcome", "severity", "summary", "changed", "details",
    ];
    const lines = [
      head.join(","),
      ...audit.map((a) =>
        [
          a.createdAt, a.realActor ?? a.actor ?? "system",
          a.realActor ? a.actor ?? "" : "",
          a.action, a.entity, a.category, a.outcome, a.severity,
          a.summary ?? "", a.changed ?? "", a.details ?? "",
        ].map(esc).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sodio-activity-page${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={cn("rise-in rise-in-3", pending && "nav-pending")}>
      <CardHeader className="gap-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ScrollText className="size-4 text-muted-foreground" /> Activity log
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {total.toLocaleString()} recorded
            {filtered ? " · filtered" : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() =>
                  go({ actor: null, action: null, entity: null, cat: null,
                       outcome: null, q: null, afrom: null, ato: null })
                }
              >
                <RotateCcw className="size-3.5" /> Clear
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="h-8" onClick={exportCsv}>
              <Download className="size-3.5" /> CSV
            </Button>
          </div>
        </CardTitle>

        {/* the filters — every one of them applied in the query */}
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q });
            }}
          >
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search all of it…"
              className="h-8 w-44 pl-8"
            />
          </form>
          <Pick label="Anyone" value={val("actor")} onChange={(v) => go({ actor: v })}
            options={options.actors} />
          <Pick label="Any action" value={val("action")} onChange={(v) => go({ action: v })}
            options={options.actions.map((a) => ({ value: a, label: a }))} />
          <Pick label="Anything" value={val("entity")} onChange={(v) => go({ entity: v })}
            options={options.entities.map((a) => ({ value: a, label: a }))} />
          <Pick label="Any kind" value={val("cat")} onChange={(v) => go({ cat: v })}
            options={options.categories.map((a) => ({ value: a, label: CATEGORY_LABEL[a] ?? a }))} />
          <Pick label="Any outcome" value={val("outcome")} onChange={(v) => go({ outcome: v })}
            options={[
              { value: "ok", label: "✅ Went through" },
              { value: "denied", label: "⛔ Refused" },
              { value: "failed", label: "⚠️ Failed" },
            ]} />
          <div className="flex items-center gap-1">
            <Input type="date" className="h-8 w-[9.5rem]"
              value={params.get("afrom") ?? ""} onChange={(e) => go({ afrom: e.target.value })} />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" className="h-8 w-[9.5rem]"
              value={params.get("ato") ?? ""} onChange={(e) => go({ ato: e.target.value })} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-1">
        {audit.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filtered
              ? "Nothing matches those filters — and this time that means the whole log was searched, not just the newest page."
              : "No activity recorded yet."}
          </p>
        ) : (
          audit.map((a) => <Row key={a.id} a={a} canUnmask={canUnmask} />)
        )}

        {total > pageSize ? (
          <div className="flex items-center justify-between gap-2 pt-3">
            <Button variant="outline" size="sm" disabled={page <= 0 || pending}
              onClick={() => go({ apage: String(page - 1) })}>
              ← Newer
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {page + 1} / {lastPage + 1}
            </span>
            <Button variant="outline" size="sm" disabled={page >= lastPage || pending}
              onClick={() => go({ apage: String(page + 1) })}>
              Older →
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  data: "✏️ Data",
  auth: "🔑 Sign-in",
  admin: "🛠️ Admin",
  access: "👁 Access",
  integration: "🔌 Integration",
  security: "🛡 Security",
};

function Pick({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  if (options.length === 0) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({ a, canUnmask }: { a: AuditEntry; canUnmask: boolean }) {
  const [open, setOpen] = useState(false);
  const bad = a.outcome !== "ok";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        bad ? "border-amber-300/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/30" : "bg-card",
        a.severity === "critical" && "border-red-400/70 bg-red-50/60 dark:bg-red-950/30"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-xs text-muted-foreground">
          {CATEGORY_LABEL[a.category]?.split(" ")[0] ?? "•"}
        </span>
        <span className="font-medium" dir="auto">{a.summary ?? a.action}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{a.entity}</span>
        {a.outcome === "denied" ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            refused
          </span>
        ) : null}
        {a.outcome === "failed" ? (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
            failed
          </span>
        ) : null}
        {a.inTestSession ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">🧪 test session</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {fmtDateTime(a.createdAt)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {/* ⚠️ WHO REALLY DID IT. An action taken inside a test view is
            attributed to the member being impersonated — deliberately, since
            v14 — so without naming the admin behind it the log cannot tell
            that apart from the member doing it themselves. That distinction is
            the entire reason the column exists. */}
        {a.realActor ? (
          <span>
            by <b className="text-foreground">{a.realActor}</b>{" "}
            <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">
              acting as {a.actor ?? "—"}
            </span>
          </span>
        ) : (
          <span>
            by <b className="text-foreground">{a.actor ?? "system"}</b>
            {a.actorAdminOnly && canUnmask ? (
              <span className="ml-1 rounded bg-muted px-1 py-0.5">🎭 anonymous · admin eyes only</span>
            ) : null}
          </span>
        )}
        {a.changed || a.details ? (
          <button
            type="button"
            className="underline-offset-2 hover:text-primary hover:underline"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "hide" : "what changed"}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-1">
          {a.changed ? <Changed json={a.changed} /> : null}
          {a.details ? (
            <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed">
              {a.details}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** {field: [from, to]} rendered as something a human reads. This is the whole
 *  value of the v36 audit: `updateAccount` used to log only the NAMES of the
 *  fields that changed, so the log could tell you a field moved and never what
 *  it moved from or to. */
function Changed({ json }: { json: string }) {
  let parsed: Record<string, [unknown, unknown]> | null = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const show = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : String(v);
  return (
    <div className="grid gap-1">
      {Object.entries(parsed).map(([field, pair]) => (
        <div key={field} className="flex flex-wrap items-baseline gap-1.5 text-xs">
          <span className="font-mono text-[11px] text-muted-foreground">{field}</span>
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 line-through opacity-70" dir="auto">
            {show(pair?.[0])}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium" dir="auto">
            {show(pair?.[1])}
          </span>
        </div>
      ))}
    </div>
  );
}
