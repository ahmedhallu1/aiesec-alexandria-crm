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
  });
  return `${day} · ${time} (Cairo time)`;
}

export interface TouchPointOption {
  scope: TouchPointScope;
  kind: TouchPointKind;
  label: string;
}

/** Every type this viewer may book, in the order they think about them. */
export function touchPointOptions(scopes: TouchPointScope[]): TouchPointOption[] {
  const kinds: TouchPointKind[] = ["meeting", "working_hours", "outing"];
  const order: TouchPointScope[] = ["team", "function", "lc"];
  return order
    .filter((s) => scopes.includes(s))
    .flatMap((scope) =>
      kinds.map((kind) => ({ scope, kind, label: touchPointLabel(scope, kind) }))
    );
}

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
