"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PickPerson {
  id: string;
  name: string;
  role: string;
  functions: string[];
  active?: boolean;
}

/** How many rows the list renders before it asks for a narrower search — a
 *  whole LC fits (the old cap of 80 already cut the Tab manager's 83). */
const LIST_CAP = 300;

/** Search-and-tick people picker (v38) — the Tab manager's "show to / hide
 *  from" and the War Room's "who scored" both use it. Chosen people sit as
 *  chips above the search; the list below filters by name, role or function.
 *  `known` (optional) names chips for ids the list doesn't offer — e.g. a
 *  member who went inactive after being picked shows as "Name (inactive)",
 *  not "Former member". */
export function PeoplePick({
  people,
  value,
  onChange,
  placeholder = "Search by name, role or function…",
  max,
  className,
  listHeight = "max-h-56",
  known,
}: {
  people: PickPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  max?: number;
  className?: string;
  listHeight?: string;
  known?: PickPerson[];
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map([...(known ?? []), ...people].map((p) => [p.id, p])), [people, known]);
  const term = q.trim().toLowerCase();
  const matches = useMemo(
    () =>
      people.filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.role.toLowerCase().includes(term) ||
          p.functions.some((f) => f.toLowerCase().includes(term))
      ),
    [people, term]
  );
  const shown = matches.slice(0, LIST_CAP);
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!max || value.length < max) onChange(max === 1 ? [id] : [...value, id]);
    else if (max === 1) onChange([id]);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      {value.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 md:gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0 pr-0 pl-2.5 text-xs font-semibold md:py-0.5 md:pr-1"
              >
                <span className="min-w-0 truncate" dir="auto">
                  {p?.name ?? "Former member"}
                  {p?.active === false ? <span className="font-normal text-muted-foreground"> (inactive)</span> : null}
                </span>
                {/* 28px hit area on phones, the old tight one on desktop */}
                <button
                  type="button"
                  aria-label={`Remove ${p?.name ?? "this person"}`}
                  onClick={() => toggle(id)}
                  className="-my-1 grid size-7 shrink-0 place-items-center rounded-full hover:bg-primary/20 md:my-0 md:size-auto md:p-0.5"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          {value.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="min-h-7 px-1.5 text-xs text-muted-foreground underline"
            >
              clear
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-8" />
      </div>
      <div className={cn("overflow-y-auto rounded-lg border", listHeight)}>
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Nobody matches “{q}”.</p>
        ) : (
          shown.map((p) => {
            const on = value.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted md:py-1.5",
                  on && "bg-primary/10"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border text-[10px]",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  )}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {p.name}
                  {p.active === false ? <span className="ml-1 text-xs text-muted-foreground">(inactive)</span> : null}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {p.role}
                  {p.functions.length ? ` · ${p.functions.slice(0, 2).join(", ")}` : ""}
                </span>
              </button>
            );
          })
        )}
        {matches.length > shown.length ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Showing {shown.length} of {matches.length} — type to narrow.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Toggle chips for a fixed list (roles, functions). */
export function ChipPick({
  options,
  value,
  onChange,
  tone = "primary",
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  tone?: "primary" | "destructive";
}) {
  return (
    <div className="flex flex-wrap gap-2 md:gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              "rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors md:py-0.5",
              on
                ? tone === "destructive"
                  ? "border-destructive bg-destructive text-white"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground hover:border-primary/50"
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
