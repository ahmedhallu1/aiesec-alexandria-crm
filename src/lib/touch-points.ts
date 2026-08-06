import { touchPointLabel, type TouchPointKind, type TouchPointScope } from "./types";

/** Pure helpers for TM touch points (v29) — shared by the server actions,
 *  the calendar and the attendance module. */

/** "Sat, Aug 9 · 6:30 PM (Cairo time)" — the LC lives on Cairo wall-clock. */
export function cairoWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} · ${time} (Cairo time)`;
}

/** B2B and BD are ONE crew — the label sits in `functions` on some rows and in
 *  `sub_functions` (or under the other name) on others, so every touch-point
 *  function match expands the pair. Mirrors `isB2B`/`memberIsB2B` elsewhere. */
const B2B_PAIR = ["B2B", "BD"];

export function expandTouchPointFns(fns: string[]): Set<string> {
  return new Set(fns.flatMap((f) => (B2B_PAIR.includes(f) ? B2B_PAIR : [f])));
}

export interface TouchPointOption {
  scope: TouchPointScope;
  kind: TouchPointKind;
  label: string;
}

/** Every type this viewer may book, in the order they think about them.
 *  `scopes` comes from rbac's `bookableTouchPointScopes`, which since v29.3
 *  hands each role exactly ONE scope (Team Leader → team · VP/Director →
 *  function · TM → lc · LCP/admin → all three), so the picker can never show
 *  a type the server would refuse. */
export function touchPointOptions(scopes: TouchPointScope[]): TouchPointOption[] {
  const kinds: TouchPointKind[] = ["meeting", "working_hours", "outing"];
  const order: TouchPointScope[] = ["team", "function", "lc"];
  return order
    .filter((s) => scopes.includes(s))
    .flatMap((scope) =>
      kinds.map((kind) => ({ scope, kind, label: touchPointLabel(scope, kind) }))
    );
}

/** Who each scope belongs to — printed under the type picker so the rule is
 *  read, not guessed. */
export const TOUCH_POINT_SCOPE_RULE: Record<TouchPointScope, string> = {
  team: "Your team — you can pull in other teams of your function.",
  function: "Your whole function — you can invite another function.",
  lc: "The whole LC. TM's call.",
};

/** The audience line shown in the UI/emails ("IGV · Falcons" / "the whole LC"). */
export function audienceLabel(tp: {
  scope: TouchPointScope;
  function_key: string | null;
  team_name: string | null;
  invited_teams?: string[] | null;
  invited_functions?: string[] | null;
}): string {
  const extra = [
    ...(tp.invited_teams ?? []),
    ...(tp.invited_functions ?? []),
  ].filter(Boolean);
  const base =
    tp.scope === "lc"
      ? "the whole LC"
      : tp.scope === "function"
        ? `${tp.function_key ?? "the function"}`
        : `${tp.team_name ?? "the team"}${tp.function_key ? ` (${tp.function_key})` : ""}`;
  return extra.length > 0 ? `${base} + ${extra.join(", ")}` : base;
}
