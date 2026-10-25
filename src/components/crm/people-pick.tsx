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

/** Search-and-tick people picker (v38) — the Tab manager's "show to / hide
 *  from" and the War Room's "who scored" both use it. Chosen people sit as
 *  chips above the search; the list below filters by name, role or function. */
export function PeoplePick({
  people,
  value,
  onChange,
  placeholder = "Search by name, role or function…",
  max,
  className,
  listHeight = "max-h-56",
}: {
  people: PickPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  max?: number;
  className?: string;
  listHeight?: string;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      people
        .filter(
          (p) =>
            !term ||
            p.name.toLowerCase().includes(term) ||
            p.role.toLowerCase().includes(term) ||
            p.functions.some((f) => f.toLowerCase().includes(term))
        )
        .slice(0, 80),
    [people, term]
  );
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!max || value.length < max) onChange(max === 1 ? [id] : [...value, id]);
    else if (max === 1) onChange([id]);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pr-1 pl-2.5 text-xs font-semibold"
            >
              <span dir="auto">{byId.get(id)?.name ?? "Former member"}</span>
              <button
                type="button"
                aria-label={`Remove ${byId.get(id)?.name ?? "this person"}`}
                onClick={() => toggle(id)}
                className="rounded-full p-0.5 hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {value.length > 1 ? (
            <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground underline">
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
                onClick={() => toggle(p.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted",
                  on && "bg-primary/10"
                )}
              >
                <span
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
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.role}
                  {p.functions.length ? ` · ${p.functions.slice(0, 2).join(", ")}` : ""}
                </span>
              </button>
            );
          })
        )}
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
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
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
