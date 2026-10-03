"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface AudiencePerson {
  id: string;
  name: string;
  role: string;
  team: string | null;
}

/** WHO IS ACTUALLY COMING (v33.34, shared in v33.35).
 *
 *  The scope decides who WOULD be invited; this is where that list gets
 *  narrowed — the three people who aren't in the function yet, the two who
 *  already said they can't. Only the ticked people are invited and only they
 *  appear on the attendance sheet.
 *
 *  One component for booking AND for editing afterwards, because a guest list
 *  that behaves differently in the two places is a guest list nobody trusts.
 *
 *  It owns no data: the caller passes the people and the exclusions, so the
 *  same control drives a form that hasn't saved yet and a row that already
 *  exists.
 */
export function AudiencePicker({
  people,
  excluded,
  onChange,
  loading,
}: {
  people: AudiencePerson[];
  /** ids that are NOT coming — the inverse, because "everyone" is the default
   *  and an empty array is the honest way to say it */
  excluded: string[];
  onChange: (excluded: string[]) => void;
  loading?: boolean;
}) {
  const [q, setQ] = useState("");
  const invitedCount = people.length - excluded.length;

  /** THE GROUPS THIS LIST ACTUALLY CONTAINS — leaders, members, and one chip
   *  per team present. Derived from the people in front of you, never from a
   *  table of what teams exist, so a chip can only ever select somebody who
   *  is already in the audience. */
  const groups = useMemo(() => {
    const LEAD = new Set(["LCP", "LCVP", "Director", "Team Leader", "Coordinator"]);
    const out: { label: string; ids: string[] }[] = [];
    const add = (label: string, ids: string[]) => {
      if (ids.length > 0 && ids.length < people.length) out.push({ label, ids });
    };
    add("Leaders & MMs", people.filter((m) => LEAD.has(m.role)).map((m) => m.id));
    add("Members only", people.filter((m) => !LEAD.has(m.role)).map((m) => m.id));
    const teams = [...new Set(people.map((m) => m.team).filter(Boolean))] as string[];
    if (teams.length > 1)
      for (const t of teams.slice(0, 6))
        add(t, people.filter((m) => m.team === t).map((m) => m.id));
    return out;
  }, [people]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.team ?? "").toLowerCase().includes(needle) ||
        m.role.toLowerCase().includes(needle)
    );
  }, [people, q]);

  /** select exactly this group — everyone else is excluded */
  const only = (ids: string[]) =>
    onChange(people.filter((m) => !ids.includes(m.id)).map((m) => m.id));

  return (
    <div className="grid gap-2">
      {people.length > 8 ? (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name, team or role…"
          className="h-8 text-sm"
        />
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {groups.map((g) => {
            const on =
              invitedCount === g.ids.length && g.ids.every((id) => !excluded.includes(id));
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => only(g.ids)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                {g.label} ({g.ids.length})
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          // (v37.8) with a search active these act on the rows you can SEE
          // (the "n of m shown" counter promised as much)
          onClick={() => {
            if (!q.trim()) return onChange([]);
            const ids = new Set(shown.map((m) => m.id));
            onChange(excluded.filter((x) => !ids.has(x)));
          }}
        >
          Select all
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          // unticking everyone would be a touch point with nobody in it —
          // the server refuses that, so the control never offers it either
          onClick={() => {
            if (!q.trim()) return onChange(people.slice(1).map((m) => m.id));
            const next = [...new Set([...excluded, ...shown.map((m) => m.id)])];
            // never leave the guest list empty — keep the first person in
            onChange(
              next.length >= people.length
                ? next.filter((x) => x !== people[0]?.id)
                : next
            );
          }}
        >
          {/* (v37.8) honest label: one person always stays ticked */}
          {q.trim() ? "Untick shown" : "Only the first person"}
        </button>
        {q ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {shown.length} of {people.length} shown
            </span>
          </>
        ) : null}
      </div>

      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            {loading ? "Loading…" : "Nobody matches that."}
          </p>
        ) : (
          shown.map((m) => {
            const on = !excluded.includes(m.id);
            return (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on ? [...excluded, m.id] : excluded.filter((x) => x !== m.id)
                    )
                  }
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  {m.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{m.role}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
