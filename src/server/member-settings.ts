import "server-only";

/** READING A MEMBER'S OWN SETTINGS (v34.8, per-topic since v36.2).
 *
 *  Unlike the function defaults, these are NOT needed to build a Viewer — no
 *  page render depends on them. They are read on two kinds of path only:
 *
 *   · the settings page itself, once, when someone opens it;
 *   · a FAN-OUT, where we are about to email or bell a set of people — and
 *     since v36.2 that happens in exactly two places, `notifyMembers` (by id)
 *     and `sendEmail` (by address), so no caller filters by hand.
 *
 *  So the useful shape is a bulk read: "of these forty people, which ones
 *  still want this?" — one query per fan-out, not one per recipient.
 *
 *  ⚠️ THIS FAILS OPEN, and that is deliberate. If the read errors, everyone
 *  is treated as opted IN. The alternative — silently suppressing a fan-out
 *  because a query blipped — turns a database hiccup into "the LC stopped
 *  being told about visits", which is far worse than one unwanted email.
 */

import { db } from "@/lib/supabase";
import {
  defaultMemberSettings, resolveMemberSettings, wants,
  type MemberSettings, type NotifyChannel, type NotifyTopic,
} from "@/lib/member-settings";

interface Row {
  id: string;
  settings: unknown;
}

/** One member's resolved settings (defaults filled in). */
export async function memberSettings(memberId: string): Promise<MemberSettings> {
  const { data, error } = await db()
    .from("members")
    .select("settings")
    .eq("id", memberId)
    .maybeSingle<{ settings: unknown }>();
  if (error || !data) return defaultMemberSettings();
  return resolveMemberSettings(data.settings);
}

/** Resolved settings for a set of members, keyed by id. Anyone missing from
 *  the result carries the defaults. */
export async function memberSettingsFor(
  ids: readonly string[]
): Promise<Map<string, MemberSettings>> {
  const out = new Map<string, MemberSettings>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return out;

  const { data, error } = await db()
    .from("members")
    .select("id, settings")
    .in("id", unique);
  if (error) {
    // fail OPEN — see the header note
    console.error("[member-settings] read failed, treating everyone as opted in:", error.message);
    for (const id of unique) out.set(id, defaultMemberSettings());
    return out;
  }
  const rows = (data ?? []) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r.settings]));
  for (const id of unique) out.set(id, resolveMemberSettings(byId.get(id)));
  return out;
}

/** OF THESE MEMBERS, THE ONES WHO STILL WANT IT (v36.2) — the bell's filter,
 *  called by `notifyMembers`. Order is kept; duplicates and blanks go. */
export async function membersWanting(
  ids: readonly string[],
  topic: NotifyTopic,
  channel: NotifyChannel
): Promise<string[]> {
  const prefs = await memberSettingsFor(ids);
  return [...prefs.keys()].filter((id) => wants(prefs.get(id), topic, channel));
}

type AddressRow = { email: string | null; fallback_email: string | null; settings: unknown };

/** THE ADDRESSES WHOSE OWNER SWITCHED THIS TOPIC'S EMAIL OFF (v36.2) — the
 *  inbox's filter, called inside `sendEmail`. Email is addressed by ADDRESS,
 *  so the member is found by it: their @aiesec.net or their backup Gmail
 *  (either one opted out blocks both, since both are the same person). An
 *  address that belongs to nobody — an IR, the LC mailbox — is never in the
 *  result. Lower-cased. Fails OPEN, to an empty set. */
export async function emailsOptedOut(
  addresses: readonly string[],
  topic: NotifyTopic
): Promise<Set<string>> {
  const out = new Set<string>();
  const trimmed = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  if (trimmed.length === 0) return out;
  // `in` is case-sensitive, and sheets have handed us both spellings before
  const variants = [...new Set(trimmed.flatMap((a) => [a, a.toLowerCase()]))];
  try {
    const [byEmail, byFallback] = await Promise.all([
      db().from("members").select("email, fallback_email, settings").in("email", variants),
      db().from("members").select("email, fallback_email, settings").in("fallback_email", variants),
    ]);
    const failed = byEmail.error ?? byFallback.error;
    if (failed) throw new Error(failed.message);
    const rows = [...(byEmail.data ?? []), ...(byFallback.data ?? [])] as AddressRow[];
    for (const r of rows) {
      if (wants(resolveMemberSettings(r.settings), topic, "email")) continue;
      for (const a of [r.email, r.fallback_email]) if (a) out.add(a.trim().toLowerCase());
    }
  } catch (e) {
    console.error(
      "[member-settings] opt-out read failed, sending to everyone:",
      e instanceof Error ? e.message : e
    );
    return new Set();
  }
  return out;
}
