"use client";

import { useEffect, useRef, useState } from "react";
import { checkContactClashesLive } from "@/server/contact-actions";
import { accountSlug, type AccountContact } from "@/lib/types";
import type { ContactClash } from "@/server/contact-clashes";

/** Live duplicate check of a contacts list (v36.5): debounced, stale answers
 *  dropped, and only values long enough to mean something are asked about. */
export function useContactClashes(
  rows: AccountContact[],
  opts: { excludeId?: string | null; enabled?: boolean } = {}
): { clashes: ContactClash[]; checking: boolean } {
  const { excludeId = null, enabled = true } = opts;
  // each answer is tagged with the values it was about, so a stale one is
  // simply not shown — nothing is reset synchronously inside the effect
  const [result, setResult] = useState<{ payload: string; clashes: ContactClash[] }>({
    payload: "[]",
    clashes: [],
  });
  const seq = useRef(0);
  const payload = enabled
    ? JSON.stringify(
        rows
          .filter((r) => r.value.trim().length >= 5)
          .map((r) => ({ tag: r.tag, kind: r.kind, value: r.value.trim() }))
      )
    : "[]";

  useEffect(() => {
    const mine = ++seq.current;
    if (payload === "[]") return;
    const t = setTimeout(async () => {
      const res = await checkContactClashesLive(JSON.parse(payload) as AccountContact[], excludeId);
      if (mine !== seq.current) return; // superseded by more typing
      setResult({ payload, clashes: res.ok ? res.data : [] });
    }, 500);
    return () => clearTimeout(t);
  }, [payload, excludeId]);

  const current = result.payload === payload;
  return {
    clashes: current ? result.clashes : [],
    checking: payload !== "[]" && !current,
  };
}

/** "This number is already on X" — the account(s) that have it, so the member
 *  can go and work that one instead of adding the same company twice. */
export function ContactClashWarning({ clashes }: { clashes: ContactClash[] }) {
  if (clashes.length === 0) return null;
  const byValue = new Map<string, ContactClash[]>();
  for (const c of clashes) byValue.set(c.value, [...(byValue.get(c.value) ?? []), c]);
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="font-semibold text-destructive">
        🚫 Already on another account — the same company under another name?
      </p>
      <ul className="mt-1.5 space-y-2">
        {[...byValue.entries()].map(([value, list]) => (
          <li key={value} className="text-xs text-foreground">
            <b dir="auto">{value}</b> is on:
            <ul className="mt-0.5 space-y-0.5 pl-3">
              {list.slice(0, 4).map((c) => (
                <li key={c.accountId}>
                  <a
                    href={`/accounts/${accountSlug(c.name)}`}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                    dir="auto"
                  >
                    {c.name}
                  </a>
                  {" · "}
                  {c.function ?? "unassigned pool"}
                  {" · "}
                  {c.responsibleName ?? "nobody holds it"}
                  {" · "}
                  {c.archived ? `archived${c.oopReason ? ` (${c.oopReason})` : ""}` : "active"}
                </li>
              ))}
              {list.length > 4 ? <li className="text-muted-foreground">+{list.length - 4} more</li> : null}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Work that account instead, or remove this value to continue.
      </p>
    </div>
  );
}
