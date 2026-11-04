import "server-only";

/** THE ACTIVATE REMINDER (v38.5) — "register for Activate", shown each time a
 *  member opens Sodio, until the registration deadline, to everyone the F&L VP
 *  hasn't ticked as registered in the War Room → Activate.
 *
 *  It runs on EVERY page view (the app layout asks), so it costs one memo
 *  lookup, not a query: the settings and the ticked ids are read at most once
 *  a minute per instance (busted on save in war-actions). A failed read shows
 *  nothing rather than nagging somebody who already paid. */

import { cairoToday } from "@/lib/types";
import type { ActivatePromptData, ActivateSettings } from "@/lib/war/model";
import type { Viewer } from "@/lib/rbac";

const TTL_MS = 60_000;
let memo: { at: number; activate: ActivateSettings; ticked: Set<string> } | null = null;

export function bustActivatePrompt(): void {
  memo = null;
}

async function load(): Promise<{ activate: ActivateSettings; ticked: Set<string> } | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo;
  try {
    const { loadWarSettings, loadDelegates } = await import("@/server/war");
    const [{ settings }, ticked] = await Promise.all([loadWarSettings(), loadDelegates()]);
    memo = { at: Date.now(), activate: settings.activate, ticked: new Set(ticked.map((t) => t.member_id)) };
    return memo;
  } catch (e) {
    console.error("[activate-prompt] read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** What the reminder shows this viewer — null when they shouldn't see it. */
export async function activatePromptFor(v: Viewer): Promise<ActivatePromptData | null> {
  if (v.impersonated) return null;
  const got = await load();
  if (!got) return null;
  const a = got.activate;
  if (!a.enabled || !a.prompt || cairoToday() > a.deadline) return null;
  if (got.ticked.has(v.id)) return null;
  return {
    name: a.name,
    dates: a.dates,
    location: a.location,
    fees: a.fees,
    downPayment: a.downPayment,
    payVia: a.payVia,
    payNumber: a.payNumber,
    formUrl: a.formUrl,
    deadline: a.deadline,
    announcement: a.announcement,
    signedBy: a.signedBy,
    seatsTaken: got.ticked.size,
    seats: a.seats,
  };
}
